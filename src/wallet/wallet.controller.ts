import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Request,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { WalletService } from './wallet.service';
import { JwtGuard } from '../auth/jwt.guard';
import { DepositDto } from './dto/deposit.dto';
import { WithdrawDto } from './dto/withdraw.dto';

@ApiTags('Wallet')
@Controller('wallet')
@UseGuards(JwtGuard)
@ApiBearerAuth('JWT-auth')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  /**
   * Get current user's wallet balance
   */
  @Get('balance')
  @ApiOperation({
    summary: 'Get wallet balance',
    description: 'Returns the current balance of the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'Current balance retrieved successfully',
    schema: {
      example: {
        balance: 1050.75,
        currency: 'USD',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
  })
  async getBalance(@Request() req: any) {
    return this.walletService.getBalance(req.user.id);
  }

  /**
   * Get all wallet transactions for current user
   */
  @Get('transactions')
  @ApiOperation({
    summary: 'Get wallet transactions',
    description:
      'Returns paginated list of all wallet transactions for the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'Transactions retrieved successfully',
    schema: {
      example: {
        transactions: [
          {
            id: 'uuid',
            userId: 'uuid',
            type: 'deposit',
            amount: 100.5,
            createdAt: '2026-02-17T10:00:00Z',
          },
        ],
        total: 15,
        limit: 50,
        offset: 0,
      },
    },
  })
  async getTransactions(
    @Request() req: any,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 50,
    @Query('offset', new ParseIntPipe({ optional: true })) offset: number = 0,
  ) {
    return this.walletService.getTransactions(req.user.id, limit, offset);
  }

  /**
   * Deposit money to wallet
   */
  @Post('deposit')
  @ApiOperation({
    summary: 'Deposit money',
    description: 'Add funds to your wallet',
  })
  @ApiResponse({
    status: 201,
    description: 'Deposit successful',
    schema: {
      example: {
        success: true,
        transaction: {
          id: 'uuid',
          type: 'deposit',
          amount: 100.5,
          newBalance: 1050.75,
          createdAt: '2026-02-17T10:00:00Z',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid amount - must be positive or User not found',
  })
  async deposit(
    @Request() req: any,
    @Body() depositDto: DepositDto,
  ) {
    return this.walletService.deposit(req.user.id, depositDto);
  }

  /**
   * Withdraw money from wallet
   */
  @Post('withdraw')
  @ApiOperation({
    summary: 'Withdraw money',
    description: 'Remove funds from your wallet',
  })
  @ApiResponse({
    status: 201,
    description: 'Withdrawal successful',
    schema: {
      example: {
        success: true,
        transaction: {
          id: 'uuid',
          type: 'withdraw',
          amount: 50.25,
          newBalance: 1000.5,
          createdAt: '2026-02-17T10:05:00Z',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid amount, insufficient balance, or User not found',
  })
  async withdraw(
    @Request() req: any,
    @Body() withdrawDto: WithdrawDto,
  ) {
    return this.walletService.withdraw(req.user.id, withdrawDto);
  }
}
