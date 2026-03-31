import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { BetsService } from './bets.service';
import { PlaceBetDto } from './dto/place-bet.dto';
import { JwtGuard } from '../auth/jwt.guard';
import { BetStatus } from './entities/bet.entity';

@ApiTags('Bets')
@Controller('bets')
export class BetsController {
  constructor(private readonly betsService: BetsService) {}

  @Get('match/:matchId/odds')
  @ApiOperation({
    summary: 'Get match odds',
    description:
      'Returns 1X2 odds and model probabilities from match_odds for a specific match',
  })
  @ApiResponse({
    status: 200,
    description: 'Match odds fetched successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'No odds found for the provided match',
  })
  async getMatchOdds(@Param('matchId') matchId: string) {
    return this.betsService.getMatchOdds(matchId);
  }

  @Post('place')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Place a new bet',
    description:
      'Places a single match-result bet (home/draw/away), debits wallet, and stores a pending bet slip',
  })
  @ApiResponse({
    status: 201,
    description: 'Bet placed successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid stake, invalid selection, match not bettable, or insufficient balance',
  })
  async placeBet(@Request() req: any, @Body() placeBetDto: PlaceBetDto) {
    return this.betsService.placeBet(req.user.id, placeBetDto);
  }

  @Get('my')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Get my bets',
    description: 'Returns paginated bets for the authenticated user',
  })
  @ApiQuery({ name: 'status', required: false, enum: BetStatus })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  @ApiQuery({ name: 'offset', required: false, example: 0 })
  async getMyBets(
    @Request() req: any,
    @Query('status') status?: BetStatus,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 50,
    @Query('offset', new ParseIntPipe({ optional: true })) offset = 0,
  ) {
    return this.betsService.getMyBets(req.user.id, limit, offset, status);
  }

  @Get(':betId')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Get my bet details',
    description: 'Returns details for one bet owned by the authenticated user',
  })
  async getBetById(@Request() req: any, @Param('betId') betId: string) {
    return this.betsService.getBetById(req.user.id, betId);
  }
}
