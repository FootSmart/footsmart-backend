import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import { Bet, BetSelection, BetStatus } from './entities/bet.entity';
import { User } from '../auth/users/entities/user.entity';
import {
  WalletTransaction,
  TransactionType,
} from '../wallet/entities/wallet-transaction.entity';

/**
 * Résultat brut d'un match depuis Supabase.
 * Le champ `result` peut être :
 *   - 'home'  → l'équipe domicile a gagné
 *   - 'draw'  → match nul
 *   - 'away'  → l'équipe extérieure a gagné
 *   - null    → pas encore de résultat
 */
interface MatchResult {
  id: string;
  status: string; // 'finished' | 'live' | 'scheduled' | ...
  result: string | null; // 'home' | 'draw' | 'away' | null
  home_goals: number;
  away_goals: number;
}

@Injectable()
export class BetsSettlementService {
  private readonly logger = new Logger(BetsSettlementService.name);

  constructor(
    @Inject('SCRAPFOOT_DB_CLIENT')
    private readonly db: SupabaseClient,

    @InjectRepository(Bet)
    private readonly betRepository: Repository<Bet>,

    @InjectRepository(User)
    private readonly userRepository: Repository<User>,

    private readonly dataSource: DataSource,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // CRON : tourne toutes les 5 minutes automatiquement
  // ─────────────────────────────────────────────────────────────────────────

  @Cron('0 */5 * * * *') // toutes les 5 minutes
  async runSettlementCron(): Promise<void> {
    this.logger.log('⚙️  Settlement cron démarré...');
    try {
      const settled = await this.settleAllPendingBets();
      if (settled > 0) {
        this.logger.log(`✅ ${settled} pari(s) réglé(s) avec succès.`);
      } else {
        this.logger.debug('Aucun pari à régler pour le moment.');
      }
    } catch (err) {
      this.logger.error(
        `❌ Erreur durant le settlement cron : ${err.message}`,
        err.stack,
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MÉTHODE PRINCIPALE : règle tous les paris PENDING dont le match est fini
  // ─────────────────────────────────────────────────────────────────────────

  async settleAllPendingBets(): Promise<number> {
    // 1. Récupérer tous les paris encore en attente
    const pendingBets = await this.betRepository.find({
      where: { status: BetStatus.PENDING },
    });

    if (pendingBets.length === 0) return 0;

    // 2. Collecter les matchId uniques de ces paris
    const uniqueMatchIds = [...new Set(pendingBets.map((b) => b.matchId))];

    // 3. Interroger Supabase pour avoir les résultats de ces matchs
    const matchResults = await this.fetchMatchResults(uniqueMatchIds);

    // 4. Régler chaque pari dont le match est terminé
    let settledCount = 0;

    for (const bet of pendingBets) {
      const matchResult = matchResults.get(bet.matchId);

      if (!matchResult) {
        // Match introuvable dans Supabase — on ignore
        continue;
      }

      if (matchResult.status !== 'finished') {
        // Match pas encore terminé — on attend
        continue;
      }

      if (!matchResult.result) {
        // Match terminé mais résultat absent — cas rare, on ignore
        this.logger.warn(`Match ${bet.matchId} terminé mais sans résultat.`);
        continue;
      }

      // 5. Comparer la sélection du pari avec le résultat du match
      const betWon = this.didBetWin(bet.selection, matchResult.result);

      // 6. Mettre à jour le pari en DB (dans une transaction atomique)
      await this.settleSingleBet(bet, betWon);
      settledCount++;
    }

    return settledCount;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SETTLEMENT D'UN SEUL MATCH (utile pour déclencher manuellement)
  // ─────────────────────────────────────────────────────────────────────────

  async settleMatchBets(
    matchId: string,
  ): Promise<{ settled: number; matchResult: string | null }> {
    // 1. Récupérer le résultat du match depuis Supabase
    const results = await this.fetchMatchResults([matchId]);
    const matchResult = results.get(matchId);

    if (!matchResult) {
      throw new Error(`Match ${matchId} introuvable dans Supabase`);
    }

    if (matchResult.status !== 'finished') {
      throw new Error(
        `Match ${matchId} n'est pas encore terminé (status: ${matchResult.status})`,
      );
    }

    if (!matchResult.result) {
      throw new Error(`Match ${matchId} terminé mais sans résultat disponible`);
    }

    // 2. Récupérer tous les paris PENDING pour ce match
    const pendingBets = await this.betRepository.find({
      where: { matchId, status: BetStatus.PENDING },
    });

    if (pendingBets.length === 0) {
      return { settled: 0, matchResult: matchResult.result };
    }

    // 3. Régler chaque pari
    let settledCount = 0;
    for (const bet of pendingBets) {
      const betWon = this.didBetWin(bet.selection, matchResult.result);
      await this.settleSingleBet(bet, betWon);
      settledCount++;
    }

    this.logger.log(
      `Match ${matchId} réglé : résultat="${matchResult.result}", ` +
        `score=${matchResult.home_goals}-${matchResult.away_goals}, ` +
        `${settledCount} pari(s) réglé(s).`,
    );

    return { settled: settledCount, matchResult: matchResult.result };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LOGIQUE PRINCIPALE : est-ce que le pari est gagné ?
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Compare la sélection du joueur avec le résultat réel du match.
   *
   * matchOutcome : 'home' | 'draw' | 'away'  (vient de Supabase)
   * selection    : BetSelection.HOME | DRAW | AWAY  (vient de la DB)
   *
   * Exemples :
   *   - Le joueur a parié HOME, le match se termine HOME → WON ✅
   *   - Le joueur a parié HOME, le match se termine DRAW → LOST ❌
   *   - Le joueur a parié DRAW, le match se termine DRAW → WON ✅
   */
  private didBetWin(selection: BetSelection, matchOutcome: string): boolean {
    /**
     * Le scraper stocke dans Supabase :
     *   'H' → Home win   (équipe domicile gagne)
     *   'D' → Draw       (match nul)
     *   'A' → Away win   (équipe extérieure gagne)
     *
     * On accepte aussi les variantes longues ('home','draw','away')
     * au cas où le scraper évolue.
     */
    const outcomeMap: Record<string, BetSelection> = {
      // Format court (scraper actuel)
      H: BetSelection.HOME,
      D: BetSelection.DRAW,
      A: BetSelection.AWAY,
      // Format long (fallback)
      home: BetSelection.HOME,
      draw: BetSelection.DRAW,
      away: BetSelection.AWAY,
    };

    // On normalise : on essaie d'abord le format exact, puis en majuscule
    const expectedSelection =
      outcomeMap[matchOutcome] ?? outcomeMap[matchOutcome.toUpperCase()];

    if (!expectedSelection) {
      this.logger.warn(
        `Résultat inconnu du match : "${matchOutcome}" — pari non réglé.`,
      );
      return false;
    }

    return selection === expectedSelection;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MISE À JOUR DB : pari + wallet (transaction atomique)
  // ─────────────────────────────────────────────────────────────────────────

  private async settleSingleBet(bet: Bet, won: boolean): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const now = new Date();

      // Mettre à jour le statut du pari
      bet.status = won ? BetStatus.WON : BetStatus.LOST;
      bet.settledAt = now;
      await manager.save(Bet, bet);

      // Si le pari est gagné → créditer le wallet du joueur
      if (won) {
        const payout = Number(Number(bet.potentialPayout).toFixed(2));

        // Récupérer l'utilisateur avec lock (évite les doublons de crédit)
        const user = await manager
          .createQueryBuilder(User, 'user')
          .where('user.id = :userId', { userId: bet.userId })
          .setLock('pessimistic_write')
          .getOne();

        if (!user) {
          this.logger.error(
            `Utilisateur ${bet.userId} introuvable pour le pari ${bet.id}`,
          );
          return;
        }

        const balanceBefore = Number(user.balance ?? 0);
        const balanceAfter = Number((balanceBefore + payout).toFixed(2));

        user.balance = balanceAfter;
        await manager.save(User, user);

        // Enregistrer la transaction de gain dans l'historique wallet
        const transaction = manager.create(WalletTransaction, {
          userId: bet.userId,
          type: TransactionType.WIN,
          amount: payout,
        });
        await manager.save(WalletTransaction, transaction);

        this.logger.log(
          `💰 Pari ${bet.id} GAGNÉ — payout: ${payout}, ` +
            `nouveau solde user ${bet.userId}: ${balanceAfter}`,
        );
      } else {
        this.logger.log(`❌ Pari ${bet.id} PERDU (user: ${bet.userId})`);
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SUPABASE : récupération des résultats de matchs
  // ─────────────────────────────────────────────────────────────────────────

  private async fetchMatchResults(
    matchIds: string[],
  ): Promise<Map<string, MatchResult>> {
    if (matchIds.length === 0) return new Map();

    const { data, error } = await this.db
      .from('matches')
      .select('id, status, result, home_goals, away_goals')
      .in('id', matchIds);

    if (error) {
      throw new Error(
        `Erreur Supabase lors de la récupération des matchs : ${error.message}`,
      );
    }

    const map = new Map<string, MatchResult>();
    for (const row of data ?? []) {
      map.set(row.id as string, {
        id: row.id as string,
        status: row.status as string,
        result: row.result as string | null,
        home_goals: Number(row.home_goals ?? 0),
        away_goals: Number(row.away_goals ?? 0),
      });
    }

    return map;
  }
}
