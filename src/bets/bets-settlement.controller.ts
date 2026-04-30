import {
  Controller,
  Post,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtGuard } from '../auth/jwt.guard';
import { AdminGuard } from '../auth/admin.guard';
import { BetsSettlementService } from './bets-settlement.service';

@ApiTags('Bets')
@Controller('bets')
export class BetsSettlementController {
  private readonly logger = new Logger(BetsSettlementController.name);

  constructor(private readonly settlementService: BetsSettlementService) {}

  @Post('settle')
  @UseGuards(JwtGuard, AdminGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Settle all eligible pending bets',
    description:
      'Finds pending bets on finished matches and settles them. Winning bets are credited once.',
  })
  @ApiResponse({
    status: 200,
    description: 'Settlement completed',
    schema: {
      example: {
        success: true,
        settled: 12,
        message: '12 bet(s) settled successfully.',
      },
    },
  })
  async settleBets() {
    this.logger.log('Manual settlement triggered via API');
    const settlement =
      await this.settlementService.settleAllPendingBetsDetailed('manual-api');
    return {
      success: true,
      settled: settlement.settled,
      won: settlement.won,
      lost: settlement.lost,
      message:
        settlement.settled > 0
          ? `${settlement.settled} bet(s) settled successfully.`
          : 'No eligible bets found (already settled or matches not finished).',
    };
  }
}
