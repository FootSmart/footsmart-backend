import {
    Body,
    Controller,
    Req,
    Post,
    UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { SubscriptionsService } from './subscriptions.service';


@ApiTags('Subscriptions')
@Controller('subscriptions')
export class SubscriptionsController {
    constructor(private readonly subscriptionsService: SubscriptionsService) {}

    @Post('revenuecat/webhook')
    @ApiOperation({
    summary: 'Handle RevenueCat webhook',
    description:
      'Receives subscription lifecycle events from RevenueCat and updates the user subscription fields.',
    })
    @ApiBearerAuth('revenuecat-webhook')
    @ApiBody({
        description: 'RevenueCat webhook payload',
        schema: {
        example: {
            event: {
            type: 'INITIAL_PURCHASE',
            app_user_id: 'user-uuid-here',
            product_id: 'monthly',
            expiration_at_ms: 1893456000000,
            },
        },
        },
    })
    @ApiResponse({
        status: 201,
        description: 'Webhook processed successfully',
        schema: {
        example: {
            received: true,
        },
        },
    })
    @ApiResponse({
        status: 401,
        description: 'Invalid RevenueCat webhook secret',
    })
    async handleRevenueCatWebhook(
        @Body() body: any,
        @Req() req: Request,
    ) {
        const authorization = req.headers['authorization'];
        const expected = `Bearer ${process.env.REVENUECAT_WEBHOOK_SECRET}`;
        
        console.log('Received auth:', authorization);
        console.log('Expected auth:', expected);

        if (authorization !== expected) {
            throw new UnauthorizedException('Invalid RevenueCat webhook secret');
        }

        await this.subscriptionsService.handleRevenueCatWebhook(body);

        return { received: true};
    }
}