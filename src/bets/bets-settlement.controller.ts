import {
  Controller,
  Post,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtGuard } from '../auth/jwt.guard';
import { BetsSettlementService } from './bets-settlement.service';

@ApiTags('Bets')
@Controller('bets/settlement')
export class BetsSettlementController {
  private readonly logger = new Logger(BetsSettlementController.name);

  constructor(private readonly settlementService: BetsSettlementService) {}

  /**
   * Déclenche le settlement de TOUS les paris pending dont le match est terminé.
   * Utile pour forcer une vérification immédiate sans attendre le cron.
   */
  @Post('run')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Déclencher le settlement de tous les paris en attente',
    description:
      'Parcourt tous les paris PENDING, vérifie dans Supabase si le match est terminé, ' +
      'puis passe le statut à WON ou LOST et crédite le wallet si gagné. ' +
      'Le cron fait cela automatiquement toutes les 5 min — cet endpoint permet de le forcer.',
  })
  @ApiResponse({
    status: 200,
    description: 'Settlement effectué',
    schema: {
      example: {
        success: true,
        settled: 3,
        message: '3 pari(s) réglé(s) avec succès.',
      },
    },
  })
  async runSettlement() {
    this.logger.log('Settlement manuel déclenché via API.');
    const settled = await this.settlementService.settleAllPendingBets();
    return {
      success: true,
      settled,
      message:
        settled > 0
          ? `${settled} pari(s) réglé(s) avec succès.`
          : 'Aucun pari à régler pour le moment (matchs pas encore terminés).',
    };
  }

  /**
   * Déclenche le settlement pour UN match précis.
   * Utile quand tu sais qu'un match vient de se terminer.
   */
  @Post('match/:matchId')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Régler les paris d\'un match spécifique',
    description:
      'Récupère le résultat du match depuis Supabase et règle tous les paris PENDING ' +
      'liés à ce match. Retourne une erreur si le match n\'est pas encore terminé.',
  })
  @ApiParam({
    name: 'matchId',
    description: 'ID du match (UUID Supabase)',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiResponse({
    status: 200,
    description: 'Paris du match réglés',
    schema: {
      example: {
        success: true,
        matchId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        matchResult: 'home',
        settled: 5,
        message: '5 pari(s) réglé(s) pour ce match. Résultat : home',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Match pas encore terminé ou résultat absent',
    schema: {
      example: {
        success: false,
        message: 'Match abc123 n\'est pas encore terminé (status: scheduled)',
      },
    },
  })
  async settleMatch(@Param('matchId') matchId: string) {
    this.logger.log(`Settlement manuel déclenché pour le match : ${matchId}`);
    try {
      const result = await this.settlementService.settleMatchBets(matchId);
      return {
        success: true,
        matchId,
        matchResult: result.matchResult,
        settled: result.settled,
        message:
          result.settled > 0
            ? `${result.settled} pari(s) réglé(s) pour ce match. Résultat : ${result.matchResult}`
            : `Aucun pari PENDING trouvé pour ce match. Résultat : ${result.matchResult}`,
      };
    } catch (err) {
      return {
        success: false,
        matchId,
        message: (err as Error).message,
      };
    }
  }
}
