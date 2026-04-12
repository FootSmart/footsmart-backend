"""
FootSmart ML — Modèle de prédiction de matchs de football
==========================================================
Pipeline complet :
  1. Extraction des données depuis Supabase (matchs terminés + odds)
  2. Feature Engineering (forme, stats H2H, moyennes glissantes)
  3. Entraînement XGBoost + LightGBM (ensemble)
  4. Prédiction sur les matchs à venir
  5. Mise à jour de la table match_odds dans Supabase
  6. API FastAPI pour exposer les prédictions au backend NestJS

Usage :
  # Entraîner et prédire une fois
  python app.py --mode train

  # Lancer l'API FastAPI
  python app.py --mode api

  # Entraîner puis lancer l'API
  python app.py --mode all
"""

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import httpx
import joblib
import numpy as np
import pandas as pd
import uvicorn
from dotenv import load_dotenv

# ── FastAPI ────────────────────────────────────────────────────────────────────
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from lightgbm import LGBMClassifier
from loguru import logger
from pydantic import BaseModel
from sklearn.ensemble import RandomForestClassifier, VotingClassifier
from sklearn.metrics import accuracy_score, classification_report
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
DATABASE_URL = os.getenv("DATABASE_URL", "")
API_HOST = os.getenv("API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("API_PORT", "8000"))
MODEL_PATH = Path(os.getenv("MODEL_PATH", "./models/footsmart_model.pkl"))
MIN_MATCHES = int(os.getenv("MIN_MATCHES_TRAIN", "100"))
RETRAIN_HOURS = int(os.getenv("RETRAIN_INTERVAL_HOURS", "24"))

# Mapping résultat Supabase → label numérique
RESULT_MAP = {"H": 0, "D": 1, "A": 2}
RESULT_LABEL = {0: "home", 1: "draw", 2: "away"}
RESULT_LABEL_FR = {0: "Victoire domicile", 1: "Match nul", 2: "Victoire extérieure"}

# ─────────────────────────────────────────────────────────────────────────────
# Logger
# ─────────────────────────────────────────────────────────────────────────────
logger.remove()
logger.add(
    sys.stdout,
    format="<green>{time:HH:mm:ss}</green> | <level>{level}</level> | {message}",
    level="INFO",
)
logger.add("logs/footsmart_ml.log", rotation="10 MB", retention="7 days", level="DEBUG")

Path("logs").mkdir(exist_ok=True)
MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)


# ─────────────────────────────────────────────────────────────────────────────
# Client Supabase REST (httpx direct — pas de lib supabase-py)
# ─────────────────────────────────────────────────────────────────────────────
class SupabaseClient:
    """
    Client léger pour l'API REST PostgREST de Supabase.
    Utilise httpx directement — aucune dépendance supabase-py.
    """

    def __init__(self, url: str, anon_key: str):
        if not url or not anon_key:
            raise ValueError(
                "SUPABASE_URL et SUPABASE_ANON_KEY doivent être définis dans .env"
            )
        self.base_url = f"{url}/rest/v1"
        self.headers = {
            "apikey": anon_key,
            "Authorization": f"Bearer {anon_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

    def select(
        self,
        table: str,
        columns: str = "*",
        filters: Optional[dict] = None,
        order: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> list[dict]:
        """
        GET /rest/v1/{table}?select=...&col=eq.val&order=...&limit=N
        Retourne la liste des lignes.
        """
        params: dict = {"select": columns}

        if filters:
            for key, value in filters.items():
                params[key] = value

        if order:
            params["order"] = order

        if limit:
            params["limit"] = limit

        url = f"{self.base_url}/{table}"
        with httpx.Client(timeout=30) as client:
            resp = client.get(url, headers=self.headers, params=params)

        if resp.status_code not in (200, 206):
            raise RuntimeError(
                f"Supabase GET /{table} → {resp.status_code}: {resp.text[:300]}"
            )

        return resp.json()

    def upsert(self, table: str, data: dict) -> None:
        """
        POST /rest/v1/{table} avec Prefer: resolution=merge-duplicates
        pour un upsert sur la clé primaire.
        """
        headers = {
            **self.headers,
            "Prefer": "resolution=merge-duplicates,return=minimal",
        }
        url = f"{self.base_url}/{table}"
        with httpx.Client(timeout=30) as client:
            resp = client.post(url, headers=headers, json=data)

        if resp.status_code not in (200, 201, 204):
            raise RuntimeError(
                f"Supabase UPSERT /{table} → {resp.status_code}: {resp.text[:300]}"
            )


def get_supabase() -> SupabaseClient:
    return SupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY)


# ─────────────────────────────────────────────────────────────────────────────
# 1. EXTRACTION DES DONNÉES
# ─────────────────────────────────────────────────────────────────────────────
class DataExtractor:
    """Extrait les données brutes depuis Supabase via httpx."""

    def __init__(self, db: SupabaseClient):
        self.db = db

    def fetch_finished_matches(self, limit: int = 5000) -> pd.DataFrame:
        """
        Récupère tous les matchs terminés avec résultat H/D/A
        et les noms des équipes/ligues via jointure PostgREST.
        """
        logger.info(f"Extraction des matchs terminés (limit={limit})...")

        columns = (
            "id,league_id,match_date,matchday,"
            "home_team_id,away_team_id,"
            "home_goals,away_goals,"
            "ht_home_goals,ht_away_goals,"
            "result,status,"
            "home_team:home_team_id(id,name),"
            "away_team:away_team_id(id,name),"
            "leagues(id,name,country)"
        )

        data = self.db.select(
            table="matches",
            columns=columns,
            filters={"status": "eq.finished", "result": "not.is.null"},
            order="match_date.desc",
            limit=limit,
        )

        if not data:
            logger.warning("Aucun match terminé trouvé dans Supabase.")
            return pd.DataFrame()

        rows = []
        for m in data:
            ht = m.get("home_team") or {}
            at = m.get("away_team") or {}
            lg = m.get("leagues") or {}
            # PostgREST retourne les jointures comme des dicts (1-to-1)
            if isinstance(ht, list):
                ht = ht[0] if ht else {}
            if isinstance(at, list):
                at = at[0] if at else {}
            if isinstance(lg, list):
                lg = lg[0] if lg else {}

            rows.append(
                {
                    "match_id": m["id"],
                    "league_id": m.get("league_id"),
                    "league_name": (lg or {}).get("name", "Unknown"),
                    "league_country": (lg or {}).get("country", "Unknown"),
                    "match_date": m.get("match_date"),
                    "matchday": m.get("matchday", 0) or 0,
                    "home_team_id": m.get("home_team_id"),
                    "away_team_id": m.get("away_team_id"),
                    "home_team_name": (ht or {}).get("name", "Unknown"),
                    "away_team_name": (at or {}).get("name", "Unknown"),
                    "home_goals": float(m.get("home_goals") or 0),
                    "away_goals": float(m.get("away_goals") or 0),
                    "ht_home_goals": float(m.get("ht_home_goals") or 0),
                    "ht_away_goals": float(m.get("ht_away_goals") or 0),
                    "result": m.get("result"),  # 'H', 'D', 'A'
                }
            )

        df = pd.DataFrame(rows)
        df["match_date"] = pd.to_datetime(df["match_date"], errors="coerce", utc=True)
        df = df.dropna(subset=["match_date", "result"])
        df = df[df["result"].isin(["H", "D", "A"])]
        df = df.sort_values("match_date").reset_index(drop=True)

        logger.info(f"  → {len(df)} matchs terminés chargés.")
        return df

    def fetch_match_odds(self) -> pd.DataFrame:
        """Récupère toutes les cotes disponibles."""
        logger.info("Extraction des cotes (match_odds)...")

        columns = (
            "match_id,home_team,away_team,"
            "home_odds,draw_odds,away_odds,"
            "home_prob,draw_prob,away_prob"
        )

        data = self.db.select(table="match_odds", columns=columns)

        if not data:
            return pd.DataFrame()

        df = pd.DataFrame(data)
        for col in [
            "home_odds",
            "draw_odds",
            "away_odds",
            "home_prob",
            "draw_prob",
            "away_prob",
        ]:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0.0)

        logger.info(f"  → {len(df)} lignes de cotes chargées.")
        return df

    def fetch_upcoming_matches(self) -> pd.DataFrame:
        """Récupère les matchs à venir pour la prédiction."""
        logger.info("Extraction des matchs à venir...")

        columns = (
            "id,league_id,match_date,matchday,"
            "home_team_id,away_team_id,status,"
            "home_team:home_team_id(id,name),"
            "away_team:away_team_id(id,name),"
            "leagues(id,name,country)"
        )

        data = self.db.select(
            table="matches",
            columns=columns,
            filters={"status": "eq.scheduled"},
            order="match_date.asc",
            limit=200,
        )

        if not data:
            logger.warning("Aucun match à venir trouvé.")
            return pd.DataFrame()

        rows = []
        for m in data:
            ht = m.get("home_team") or {}
            at = m.get("away_team") or {}
            lg = m.get("leagues") or {}
            if isinstance(ht, list):
                ht = ht[0] if ht else {}
            if isinstance(at, list):
                at = at[0] if at else {}
            if isinstance(lg, list):
                lg = lg[0] if lg else {}

            rows.append(
                {
                    "match_id": m["id"],
                    "league_id": m.get("league_id"),
                    "league_name": (lg or {}).get("name", "Unknown"),
                    "match_date": m.get("match_date"),
                    "matchday": m.get("matchday", 0) or 0,
                    "home_team_id": m.get("home_team_id"),
                    "away_team_id": m.get("away_team_id"),
                    "home_team_name": (ht or {}).get("name", "Unknown"),
                    "away_team_name": (at or {}).get("name", "Unknown"),
                }
            )

        df = pd.DataFrame(rows)
        df["match_date"] = pd.to_datetime(df["match_date"], errors="coerce", utc=True)
        df = df.dropna(subset=["match_date"])
        logger.info(f"  → {len(df)} matchs à venir chargés.")
        return df


# ─────────────────────────────────────────────────────────────────────────────
# 2. FEATURE ENGINEERING
# ─────────────────────────────────────────────────────────────────────────────
class FeatureEngineer:
    """
    Construit les features à partir des matchs historiques.

    Features créées :
      - Forme récente (derniers 5 matchs) : wins/draws/losses/goals
      - H2H (head-to-head) historique entre les deux équipes
      - Buts marqués/encaissés en moyenne (fenêtre 5 et 10 matchs)
      - Cotes du bookmaker (signal fort)
      - Avantage domicile
      - Ranking implicite des équipes
    """

    def _team_recent_form(
        self,
        team_id: str,
        before_date: pd.Timestamp,
        matches_df: pd.DataFrame,
        n: int = 5,
    ) -> dict:
        """Stats de l'équipe sur les N derniers matchs avant une date."""
        team_matches = matches_df[
            (
                (matches_df["home_team_id"] == team_id)
                | (matches_df["away_team_id"] == team_id)
            )
            & (matches_df["match_date"] < before_date)
        ].tail(n)

        if team_matches.empty:
            return {
                "wins": 0,
                "draws": 0,
                "losses": 0,
                "goals_for": 0.0,
                "goals_against": 0.0,
                "points": 0,
                "played": 0,
            }

        wins = draws = losses = 0
        goals_for = goals_against = 0.0

        for _, row in team_matches.iterrows():
            is_home = row["home_team_id"] == team_id
            gf = row["home_goals"] if is_home else row["away_goals"]
            ga = row["away_goals"] if is_home else row["home_goals"]
            res = row["result"]

            goals_for += gf
            goals_against += ga

            if (res == "H" and is_home) or (res == "A" and not is_home):
                wins += 1
            elif res == "D":
                draws += 1
            else:
                losses += 1

        played = len(team_matches)
        return {
            "wins": wins,
            "draws": draws,
            "losses": losses,
            "goals_for": round(goals_for / played, 2) if played else 0.0,
            "goals_against": round(goals_against / played, 2) if played else 0.0,
            "points": wins * 3 + draws,
            "played": played,
        }

    def _h2h_stats(
        self,
        home_team_id: str,
        away_team_id: str,
        before_date: pd.Timestamp,
        matches_df: pd.DataFrame,
        n: int = 6,
    ) -> dict:
        """Historique des confrontations directes entre 2 équipes."""
        h2h = matches_df[
            (
                (
                    (matches_df["home_team_id"] == home_team_id)
                    & (matches_df["away_team_id"] == away_team_id)
                )
                | (
                    (matches_df["home_team_id"] == away_team_id)
                    & (matches_df["away_team_id"] == home_team_id)
                )
            )
            & (matches_df["match_date"] < before_date)
        ].tail(n)

        if h2h.empty:
            return {
                "h2h_home_wins": 0,
                "h2h_draws": 0,
                "h2h_away_wins": 0,
                "h2h_played": 0,
            }

        home_wins = draws = away_wins = 0
        for _, row in h2h.iterrows():
            actual_home = row["home_team_id"] == home_team_id
            res = row["result"]
            if res == "H":
                if actual_home:
                    home_wins += 1
                else:
                    away_wins += 1
            elif res == "D":
                draws += 1
            else:
                if actual_home:
                    away_wins += 1
                else:
                    home_wins += 1

        return {
            "h2h_home_wins": home_wins,
            "h2h_draws": draws,
            "h2h_away_wins": away_wins,
            "h2h_played": len(h2h),
        }

    def build_features(
        self,
        matches_df: pd.DataFrame,
        odds_df: pd.DataFrame,
        target_matches: Optional[pd.DataFrame] = None,
    ) -> pd.DataFrame:
        """
        Construit le DataFrame de features.
        Si target_matches est None → mode entraînement (sur matchs terminés).
        Si target_matches fourni  → mode prédiction (sur matchs à venir).
        """
        source = target_matches if target_matches is not None else matches_df

        logger.info(f"Feature engineering sur {len(source)} matchs...")

        # Merge avec les cotes
        if not odds_df.empty:
            source = source.merge(
                odds_df[
                    [
                        "match_id",
                        "home_odds",
                        "draw_odds",
                        "away_odds",
                        "home_prob",
                        "draw_prob",
                        "away_prob",
                    ]
                ],
                on="match_id",
                how="left",
            )
        else:
            for col in [
                "home_odds",
                "draw_odds",
                "away_odds",
                "home_prob",
                "draw_prob",
                "away_prob",
            ]:
                source[col] = 0.0

        rows = []
        for _, match in source.iterrows():
            date = match["match_date"]
            home_id = match["home_team_id"]
            away_id = match["away_team_id"]

            # Forme équipe domicile (5 derniers matchs)
            home_form = self._team_recent_form(home_id, date, matches_df, n=5)
            # Forme équipe extérieure (5 derniers matchs)
            away_form = self._team_recent_form(away_id, date, matches_df, n=5)
            # Forme longue (10 derniers matchs) pour la stabilité
            home_form_long = self._team_recent_form(home_id, date, matches_df, n=10)
            away_form_long = self._team_recent_form(away_id, date, matches_df, n=10)
            # H2H
            h2h = self._h2h_stats(home_id, away_id, date, matches_df)

            # Cotes (signal bookmaker = feature très puissante)
            h_odds = float(match.get("home_odds") or 0)
            d_odds = float(match.get("draw_odds") or 0)
            a_odds = float(match.get("away_odds") or 0)
            h_prob = float(match.get("home_prob") or 0)
            d_prob = float(match.get("draw_prob") or 0)
            a_prob = float(match.get("away_prob") or 0)

            # Probabilité implicite depuis les cotes (si proba absente)
            if h_odds > 0 and h_prob == 0:
                total = (
                    (1 / h_odds + 1 / d_odds + 1 / a_odds) if d_odds and a_odds else 1
                )
                h_prob = (1 / h_odds) / total
                d_prob = (1 / d_odds) / total if d_odds else 0
                a_prob = (1 / a_odds) / total if a_odds else 0

            row = {
                "match_id": match["match_id"],
                # ── Forme domicile (court terme) ──
                "home_wins_5": home_form["wins"],
                "home_draws_5": home_form["draws"],
                "home_losses_5": home_form["losses"],
                "home_gf_5": home_form["goals_for"],
                "home_ga_5": home_form["goals_against"],
                "home_points_5": home_form["points"],
                # ── Forme extérieure (court terme) ──
                "away_wins_5": away_form["wins"],
                "away_draws_5": away_form["draws"],
                "away_losses_5": away_form["losses"],
                "away_gf_5": away_form["goals_for"],
                "away_ga_5": away_form["goals_against"],
                "away_points_5": away_form["points"],
                # ── Différentiels de forme ──
                "diff_points_5": home_form["points"] - away_form["points"],
                "diff_gf_5": home_form["goals_for"] - away_form["goals_for"],
                "diff_ga_5": home_form["goals_against"] - away_form["goals_against"],
                # ── Forme longue (stabilité) ──
                "home_points_10": home_form_long["points"],
                "away_points_10": away_form_long["points"],
                "diff_points_10": home_form_long["points"] - away_form_long["points"],
                # ── H2H ──
                "h2h_home_wins": h2h["h2h_home_wins"],
                "h2h_draws": h2h["h2h_draws"],
                "h2h_away_wins": h2h["h2h_away_wins"],
                "h2h_played": h2h["h2h_played"],
                "h2h_home_rate": (h2h["h2h_home_wins"] / h2h["h2h_played"])
                if h2h["h2h_played"]
                else 0.33,
                # ── Cotes & probabilités bookmaker ──
                "home_odds": h_odds,
                "draw_odds": d_odds,
                "away_odds": a_odds,
                "home_prob": h_prob,
                "draw_prob": d_prob,
                "away_prob": a_prob,
                # ── Features dérivées des cotes ──
                "odds_home_vs_away": (h_odds / a_odds) if a_odds > 0 else 1.0,
                "prob_diff_home_away": h_prob - a_prob,
                "favorite": 0
                if h_prob > max(d_prob, a_prob)
                else (1 if d_prob > max(h_prob, a_prob) else 2),
                # ── Contexte du match ──
                "matchday": float(match.get("matchday") or 0),
            }

            # En mode entraînement, ajouter la cible
            if target_matches is None and "result" in match:
                row["target"] = RESULT_MAP.get(match["result"], -1)

            rows.append(row)

        df = pd.DataFrame(rows)
        if "target" in df.columns:
            df = df[df["target"] >= 0]  # Supprimer les résultats invalides

        logger.info(
            f"  → {len(df)} lignes de features générées avec {len(df.columns)} colonnes."
        )
        return df


# ─────────────────────────────────────────────────────────────────────────────
# 3. ENTRAÎNEMENT DU MODÈLE
# ─────────────────────────────────────────────────────────────────────────────
FEATURE_COLS = [
    "home_wins_5",
    "home_draws_5",
    "home_losses_5",
    "home_gf_5",
    "home_ga_5",
    "home_points_5",
    "away_wins_5",
    "away_draws_5",
    "away_losses_5",
    "away_gf_5",
    "away_ga_5",
    "away_points_5",
    "diff_points_5",
    "diff_gf_5",
    "diff_ga_5",
    "home_points_10",
    "away_points_10",
    "diff_points_10",
    "h2h_home_wins",
    "h2h_draws",
    "h2h_away_wins",
    "h2h_played",
    "h2h_home_rate",
    "home_odds",
    "draw_odds",
    "away_odds",
    "home_prob",
    "draw_prob",
    "away_prob",
    "odds_home_vs_away",
    "prob_diff_home_away",
    "favorite",
    "matchday",
]


class ModelTrainer:
    """Entraîne et évalue le modèle d'ensemble XGBoost + LightGBM."""

    def __init__(self):
        self.model = None
        self.feature_cols = FEATURE_COLS
        self.trained_at: Optional[datetime] = None
        self.accuracy: float = 0.0
        self.n_train: int = 0

    def train(self, features_df: pd.DataFrame) -> float:
        """Entraîne le modèle et retourne l'accuracy sur le test set."""
        if len(features_df) < MIN_MATCHES:
            raise ValueError(
                f"Pas assez de données : {len(features_df)} matchs "
                f"(minimum requis : {MIN_MATCHES})."
            )

        X = features_df[self.feature_cols].fillna(0.0)
        y = features_df["target"]

        logger.info(
            f"Distribution des classes : H={sum(y == 0)} D={sum(y == 1)} A={sum(y == 2)}"
        )

        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y
        )

        logger.info(
            f"Entraînement sur {len(X_train)} matchs, test sur {len(X_test)} matchs..."
        )

        # ── Random Forest (scikit-learn — compatible Python 3.14) ────────────
        rf = RandomForestClassifier(
            n_estimators=300,
            max_depth=8,
            min_samples_split=5,
            min_samples_leaf=2,
            random_state=42,
            n_jobs=-1,
        )

        # ── LightGBM ─────────────────────────────────────────────────────────
        lgbm = LGBMClassifier(
            n_estimators=300,
            max_depth=5,
            learning_rate=0.05,
            subsample=0.8,
            colsample_bytree=0.8,
            random_state=42,
            verbose=-1,
        )

        # ── Ensemble (vote souple = moyenne des probabilités) ─────────────────
        self.model = VotingClassifier(
            estimators=[("rf", rf), ("lgbm", lgbm)],
            voting="soft",
            weights=[1, 1],
        )

        self.model.fit(X_train, y_train)

        y_pred = self.model.predict(X_test)
        self.accuracy = accuracy_score(y_test, y_pred)
        self.trained_at = datetime.utcnow()
        self.n_train = len(X_train)

        logger.info(f"✅ Accuracy : {self.accuracy:.2%}")
        logger.info(
            "\n"
            + classification_report(
                y_test, y_pred, target_names=["Home", "Draw", "Away"]
            )
        )

        return self.accuracy

    def predict_proba(self, features_df: pd.DataFrame) -> np.ndarray:
        """Retourne les probabilités [P(Home), P(Draw), P(Away)] pour chaque match."""
        if self.model is None:
            raise RuntimeError("Le modèle n'est pas entraîné. Lance d'abord train().")

        X = features_df[self.feature_cols].fillna(0.0)
        return self.model.predict_proba(X)

    def save(self, path: Path = MODEL_PATH):
        """Sauvegarde le modèle entraîné sur disque."""
        payload = {
            "model": self.model,
            "feature_cols": self.feature_cols,
            "trained_at": self.trained_at,
            "accuracy": self.accuracy,
            "n_train": self.n_train,
        }
        joblib.dump(payload, path)
        logger.info(f"💾 Modèle sauvegardé → {path}")

    def load(self, path: Path = MODEL_PATH) -> bool:
        """Charge le modèle depuis le disque. Retourne True si succès."""
        if not path.exists():
            logger.warning(f"Aucun modèle trouvé à {path}.")
            return False
        payload = joblib.load(path)
        self.model = payload["model"]
        self.feature_cols = payload["feature_cols"]
        self.trained_at = payload["trained_at"]
        self.accuracy = payload["accuracy"]
        self.n_train = payload["n_train"]
        logger.info(
            f"✅ Modèle chargé — accuracy={self.accuracy:.2%}, "
            f"entraîné le {self.trained_at}, sur {self.n_train} matchs."
        )
        return True

    def needs_retrain(self) -> bool:
        """Retourne True si le modèle est absent ou trop vieux."""
        if self.trained_at is None:
            return True
        age = datetime.utcnow() - self.trained_at
        return age > timedelta(hours=RETRAIN_HOURS)


# ─────────────────────────────────────────────────────────────────────────────
# 4. PRÉDICTIONS + MISE À JOUR SUPABASE
# ─────────────────────────────────────────────────────────────────────────────
class PredictionEngine:
    """Génère les prédictions et les écrit dans Supabase."""

    def __init__(
        self, db: SupabaseClient, trainer: ModelTrainer, engineer: FeatureEngineer
    ):
        self.db = db
        self.trainer = trainer
        self.engineer = engineer

    def predict_upcoming(
        self,
        finished_df: pd.DataFrame,
        upcoming_df: pd.DataFrame,
        odds_df: pd.DataFrame,
    ) -> list[dict]:
        """
        Génère les prédictions pour tous les matchs à venir.
        Retourne une liste de dicts prêts pour l'API ou Supabase.
        """
        if upcoming_df.empty:
            logger.warning("Aucun match à venir à prédire.")
            return []

        # Construire les features pour les matchs à venir
        features_df = self.engineer.build_features(
            matches_df=finished_df,
            odds_df=odds_df,
            target_matches=upcoming_df,
        )

        if features_df.empty:
            return []

        # Prédire les probabilités
        probas = self.trainer.predict_proba(features_df)

        predictions = []
        for i, (_, feat_row) in enumerate(features_df.iterrows()):
            match_id = feat_row["match_id"]

            # Retrouver les infos du match
            match_info = upcoming_df[upcoming_df["match_id"] == match_id]
            if match_info.empty:
                continue
            match_info = match_info.iloc[0]

            p_home, p_draw, p_away = probas[i]

            # Outcome prédit = probabilité la plus haute
            best_idx = int(np.argmax([p_home, p_draw, p_away]))
            outcome = RESULT_LABEL[best_idx]
            confidence = round(float(max(p_home, p_draw, p_away)) * 100, 1)

            # Niveau de confiance
            if confidence >= 65:
                confidence_level = "high"
            elif confidence >= 50:
                confidence_level = "medium"
            else:
                confidence_level = "low"

            # Cotes brutes (du bookmaker)
            h_odds = float(feat_row.get("home_odds") or 0)
            d_odds = float(feat_row.get("draw_odds") or 0)
            a_odds = float(feat_row.get("away_odds") or 0)

            # Cotes ML (1 / probabilité)
            ml_h_odds = round(1 / p_home, 2) if p_home > 0 else 0
            ml_d_odds = round(1 / p_draw, 2) if p_draw > 0 else 0
            ml_a_odds = round(1 / p_away, 2) if p_away > 0 else 0

            home_name = str(match_info.get("home_team_name", ""))
            away_name = str(match_info.get("away_team_name", ""))

            if outcome == "home":
                predicted_label = f"{home_name} Win"
            elif outcome == "draw":
                predicted_label = "Draw"
            else:
                predicted_label = f"{away_name} Win"

            predictions.append(
                {
                    "matchId": match_id,
                    "leagueId": str(match_info.get("league_id", "") or ""),
                    "homeTeam": home_name,
                    "awayTeam": away_name,
                    "matchDate": str(match_info.get("match_date", "")),
                    "leagueName": str(match_info.get("league_name", "")),
                    "predictedOutcome": outcome,
                    "predictedLabel": predicted_label,
                    "confidence": confidence,
                    "confidenceLevel": confidence_level,
                    # Probabilités ML brutes
                    "homeProb": round(float(p_home), 4),
                    "drawProb": round(float(p_draw), 4),
                    "awayProb": round(float(p_away), 4),
                    # Cotes bookmaker (si disponibles)
                    "homeOdds": h_odds,
                    "drawOdds": d_odds,
                    "awayOdds": a_odds,
                    # Cotes ML (calculées par le modèle)
                    "mlHomeOdds": ml_h_odds,
                    "mlDrawOdds": ml_d_odds,
                    "mlAwayOdds": ml_a_odds,
                }
            )

        logger.info(f"✅ {len(predictions)} prédictions générées.")
        return predictions

    def upsert_to_supabase(self, predictions: list[dict]) -> int:
        """
        Met à jour la table match_odds dans Supabase
        avec les probabilités calculées par le ML.
        Retourne le nombre de lignes mises à jour.
        """
        if not predictions:
            return 0

        updated = 0
        for pred in predictions:
            try:
                self.db.upsert(
                    table="match_odds",
                    data={
                        "match_id": pred["matchId"],
                        "home_team": pred["homeTeam"],
                        "away_team": pred["awayTeam"],
                        "home_prob": pred["homeProb"],
                        "draw_prob": pred["drawProb"],
                        "away_prob": pred["awayProb"],
                    },
                )
                updated += 1
            except Exception as e:
                logger.warning(f"Upsert échoué pour match {pred['matchId']}: {e}")

        logger.info(f"💾 {updated} lignes mises à jour dans match_odds (Supabase).")
        return updated


# ─────────────────────────────────────────────────────────────────────────────
# 5. PIPELINE COMPLET
# ─────────────────────────────────────────────────────────────────────────────
class FootSmartPipeline:
    """Orchestre extraction → features → entraînement → prédiction → upsert."""

    def __init__(self):
        self.db: SupabaseClient = get_supabase()
        self.extractor = DataExtractor(self.db)
        self.engineer = FeatureEngineer()
        self.trainer = ModelTrainer()
        self.engine = PredictionEngine(self.db, self.trainer, self.engineer)

        # Cache en mémoire (rafraîchi toutes les RETRAIN_HOURS heures)
        self._finished_df: Optional[pd.DataFrame] = None
        self._odds_df: Optional[pd.DataFrame] = None
        self._predictions: list[dict] = []
        self._last_refresh: Optional[datetime] = None

    def run_training(self) -> float:
        """Exécute le pipeline complet d'entraînement."""
        logger.info("=" * 60)
        logger.info("🚀 Démarrage du pipeline d'entraînement FootSmart ML")
        logger.info("=" * 60)

        # 1. Extraction
        finished_df = self.extractor.fetch_finished_matches(limit=5000)
        odds_df = self.extractor.fetch_match_odds()

        if finished_df.empty:
            raise RuntimeError(
                "Impossible d'entraîner : aucun match terminé dans Supabase."
            )

        # 2. Features
        features_df = self.engineer.build_features(finished_df, odds_df)

        # 3. Entraînement
        accuracy = self.trainer.train(features_df)

        # 4. Sauvegarde
        self.trainer.save(MODEL_PATH)

        # Cache
        self._finished_df = finished_df
        self._odds_df = odds_df

        logger.info(f"✅ Pipeline d'entraînement terminé — Accuracy : {accuracy:.2%}")
        return accuracy

    def run_predictions(self, upsert: bool = True) -> list[dict]:
        """Génère les prédictions sur les matchs à venir."""
        logger.info("=" * 60)
        logger.info("🔮 Génération des prédictions FootSmart ML")
        logger.info("=" * 60)

        # Charger le modèle si nécessaire
        if self.trainer.model is None:
            loaded = self.trainer.load(MODEL_PATH)
            if not loaded:
                logger.info("Aucun modèle trouvé, entraînement en cours...")
                self.run_training()

        # Extraire les données si pas encore en cache
        if self._finished_df is None:
            self._finished_df = self.extractor.fetch_finished_matches()
        if self._odds_df is None:
            self._odds_df = self.extractor.fetch_match_odds()

        upcoming_df = self.extractor.fetch_upcoming_matches()

        predictions = self.engine.predict_upcoming(
            self._finished_df, upcoming_df, self._odds_df
        )

        # Mise à jour Supabase
        if upsert and predictions:
            self.engine.upsert_to_supabase(predictions)

        self._predictions = predictions
        self._last_refresh = datetime.utcnow()
        return predictions

    def run_all(self) -> list[dict]:
        """Entraîne + prédit en une seule passe."""
        self.run_training()
        return self.run_predictions(upsert=True)

    def get_cached_predictions(self) -> list[dict]:
        """Retourne les prédictions en cache ou les régénère si vieilles."""
        if not self._predictions or self.trainer.needs_retrain():
            return self.run_predictions()
        return self._predictions


# ─────────────────────────────────────────────────────────────────────────────
# 6. API FASTAPI
# ─────────────────────────────────────────────────────────────────────────────

# Instance globale du pipeline (partagée par tous les endpoints)
_pipeline: Optional[FootSmartPipeline] = None


def get_pipeline() -> FootSmartPipeline:
    global _pipeline
    if _pipeline is None:
        _pipeline = FootSmartPipeline()
    return _pipeline


app = FastAPI(
    title="FootSmart ML API",
    description=(
        "API de prédiction de matchs de football par Machine Learning.\n\n"
        "- Entraînement sur les matchs historiques Supabase\n"
        "- Prédictions pour les matchs à venir (H/D/A avec confidence)\n"
        "- Mise à jour automatique des probabilités dans match_odds\n"
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Modèles de réponse Pydantic ───────────────────────────────────────────────


class PredictionItem(BaseModel):
    matchId: str
    leagueId: str = ""
    homeTeam: str
    awayTeam: str
    matchDate: str
    leagueName: str
    predictedOutcome: str  # 'home' | 'draw' | 'away'
    predictedLabel: str  # ex: "Man City Win"
    confidence: float  # 0-100
    confidenceLevel: str  # 'high' | 'medium' | 'low'
    homeProb: float
    drawProb: float
    awayProb: float
    homeOdds: float
    drawOdds: float
    awayOdds: float
    mlHomeOdds: float
    mlDrawOdds: float
    mlAwayOdds: float


class PredictionsResponse(BaseModel):
    count: int
    predictions: list[PredictionItem]
    modelAccuracy: float
    trainedAt: Optional[str]
    generatedAt: str


class TrainResponse(BaseModel):
    success: bool
    accuracy: float
    nTrain: int
    trainedAt: str
    message: str


class HealthResponse(BaseModel):
    status: str
    modelLoaded: bool
    modelAccuracy: float
    trainedAt: Optional[str]
    predictionsCount: int


# ── Endpoints ─────────────────────────────────────────────────────────────────


@app.get("/", tags=["Health"])
def root():
    return {"message": "FootSmart ML API — voir /docs pour la documentation."}


@app.get("/health", response_model=HealthResponse, tags=["Health"])
def health():
    """Statut de l'API et du modèle ML."""
    pl = get_pipeline()
    return HealthResponse(
        status="ok",
        modelLoaded=pl.trainer.model is not None,
        modelAccuracy=round(pl.trainer.accuracy * 100, 1),
        trainedAt=str(pl.trainer.trained_at) if pl.trainer.trained_at else None,
        predictionsCount=len(pl._predictions),
    )


@app.post("/train", response_model=TrainResponse, tags=["Model"])
def train_model():
    """
    Déclenche l'entraînement complet du modèle ML.
    - Récupère les matchs terminés depuis Supabase
    - Calcule les features (forme, H2H, cotes)
    - Entraîne XGBoost + LightGBM (ensemble)
    - Sauvegarde le modèle sur disque
    """
    pl = get_pipeline()
    try:
        accuracy = pl.run_training()
        return TrainResponse(
            success=True,
            accuracy=round(accuracy * 100, 1),
            nTrain=pl.trainer.n_train,
            trainedAt=str(pl.trainer.trained_at),
            message=f"Modèle entraîné avec succès — Accuracy : {accuracy:.2%}",
        )
    except Exception as e:
        logger.error(f"Erreur d'entraînement : {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/predictions", response_model=PredictionsResponse, tags=["Predictions"])
def get_predictions(
    league_id: Optional[str] = Query(None, description="Filtrer par league_id"),
    min_confidence: float = Query(0.0, description="Confiance minimale (0-100)"),
    limit: int = Query(50, description="Nombre max de prédictions"),
    upsert: bool = Query(True, description="Mettre à jour Supabase après prédiction"),
):
    """
    Retourne les prédictions ML pour tous les matchs à venir.
    Chaque prédiction inclut :
    - L'outcome prédit (home/draw/away)
    - La confiance du modèle (%)
    - Les probabilités brutes (homeProb, drawProb, awayProb)
    - Les cotes ML calculées par le modèle
    - Les cotes bookmaker (si disponibles dans match_odds)
    """
    pl = get_pipeline()
    try:
        predictions = pl.run_predictions(upsert=upsert)
    except Exception as e:
        logger.error(f"Erreur de prédiction : {e}")
        raise HTTPException(status_code=500, detail=str(e))

    # Filtrage
    if league_id:
        predictions = [p for p in predictions if p.get("leagueId") == league_id]
    if min_confidence > 0:
        predictions = [p for p in predictions if p["confidence"] >= min_confidence]

    predictions = predictions[:limit]

    return PredictionsResponse(
        count=len(predictions),
        predictions=[PredictionItem(**p) for p in predictions],
        modelAccuracy=round(pl.trainer.accuracy * 100, 1),
        trainedAt=str(pl.trainer.trained_at) if pl.trainer.trained_at else None,
        generatedAt=str(pl._last_refresh or datetime.utcnow()),
    )


@app.get("/predictions/{match_id}", response_model=PredictionItem, tags=["Predictions"])
def get_prediction_for_match(match_id: str):
    """Retourne la prédiction ML pour un match spécifique."""
    pl = get_pipeline()
    predictions = pl.get_cached_predictions()
    match = next((p for p in predictions if p["matchId"] == match_id), None)
    if not match:
        raise HTTPException(
            status_code=404, detail=f"Aucune prédiction pour le match {match_id}"
        )
    return PredictionItem(**match)


@app.post("/retrain-and-predict", tags=["Model"])
def retrain_and_predict(upsert: bool = Query(True)):
    """
    Entraîne le modèle puis génère immédiatement les prédictions.
    Utile pour forcer une mise à jour complète.
    """
    pl = get_pipeline()
    try:
        predictions = pl.run_all()
        return {
            "success": True,
            "trained": True,
            "accuracy": round(pl.trainer.accuracy * 100, 1),
            "predictions": len(predictions),
            "message": f"Modèle ré-entraîné et {len(predictions)} prédictions générées.",
        }
    except Exception as e:
        logger.error(f"Erreur retrain+predict : {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────────────────────────────────────────
# 7. POINT D'ENTRÉE
# ─────────────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="FootSmart ML Pipeline")
    parser.add_argument(
        "--mode",
        choices=["train", "predict", "api", "all"],
        default="all",
        help=(
            "train   → Entraîner le modèle uniquement\n"
            "predict → Prédire les matchs à venir\n"
            "api     → Lancer l'API FastAPI\n"
            "all     → Entraîner + prédire + lancer l'API"
        ),
    )
    args = parser.parse_args()

    pipeline = get_pipeline()

    if args.mode == "train":
        accuracy = pipeline.run_training()
        logger.info(f"✅ Entraînement terminé — Accuracy : {accuracy:.2%}")

    elif args.mode == "predict":
        loaded = pipeline.trainer.load(MODEL_PATH)
        if not loaded:
            logger.info("Aucun modèle en cache, entraînement en cours...")
            pipeline.run_training()
        preds = pipeline.run_predictions(upsert=True)
        logger.info(f"✅ {len(preds)} prédictions générées et upsertées dans Supabase.")
        # Afficher un aperçu
        for p in preds[:5]:
            logger.info(
                f"  {p['homeTeam']} vs {p['awayTeam']} → "
                f"{p['predictedLabel']} ({p['confidence']}% - {p['confidenceLevel'].upper()})"
            )

    elif args.mode == "api":
        loaded = pipeline.trainer.load(MODEL_PATH)
        if not loaded:
            logger.info("Aucun modèle trouvé, entraînement avant démarrage de l'API...")
            pipeline.run_training()
        logger.info(f"🚀 API FootSmart ML démarrée sur http://{API_HOST}:{API_PORT}")
        logger.info(f"📖 Documentation : http://{API_HOST}:{API_PORT}/docs")
        uvicorn.run(app, host=API_HOST, port=API_PORT, log_level="warning")

    elif args.mode == "all":
        pipeline.run_training()
        pipeline.run_predictions(upsert=True)
        logger.info(f"🚀 API FootSmart ML démarrée sur http://{API_HOST}:{API_PORT}")
        logger.info(f"📖 Documentation : http://{API_HOST}:{API_PORT}/docs")
        uvicorn.run(app, host=API_HOST, port=API_PORT, log_level="warning")


if __name__ == "__main__":
    main()
