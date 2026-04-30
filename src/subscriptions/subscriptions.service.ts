import { Injectable } from "@nestjs/common";
import { UsersService } from "src/auth/users/users.service";

@Injectable()
export class SubscriptionsService{
    constructor(private readonly usersService: UsersService) {}

    async handleRevenueCatWebhook(payload: any) {
        const event = payload.event;
        if(!event) return;
        
        const userId = event.app_user_id;
        if (!userId) return;

        const eventType = event.type;
        const productId = event.product_id ?? null;

        const expirationAt = event.expiration_at_ms
        ? new Date(event.expiration_at_ms)
        : null;

        const now = new Date();

        const stillActive = 
        expirationAt !== null && expirationAt.getTime() > now.getTime();

        if (
            eventType === 'INITIAL_PURCHASE' ||
            eventType === 'RENEWAL' ||
            eventType === 'UNCANCELLATION' ||
            eventType === 'PRODUCT_CHANGE'
        ) {
            await this.usersService.updateSubscription(userId, {
                subscriptionActive: true,
                subscriptionPlan: productId,
                subscriptionEndsAt: expirationAt,
            });
            return;
        }

        if (eventType === 'CANCELLATION') {
            await this.usersService.updateSubscription(userId, {
                subscriptionActive: false,
                subscriptionPlan: productId,
                subscriptionEndsAt: expirationAt,
            });
            return;
        }

        if (eventType === 'EXPIRATION') {
            await this.usersService.updateSubscription(userId, {
                subscriptionActive: false,
                subscriptionPlan: productId,
                subscriptionEndsAt: expirationAt,
            });

            return;
        }

        if (eventType === 'BILLING_ISSUE') {
            await this.usersService.updateSubscription(userId, {
                subscriptionActive: stillActive,
                subscriptionPlan: productId,
                subscriptionEndsAt: expirationAt,
            });
        }
    }
}