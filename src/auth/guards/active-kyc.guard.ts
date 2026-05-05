import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';

@Injectable()
export class ActiveKycGuard implements CanActivate {
  constructor(private readonly usersService: UsersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request?.user?.id as string | undefined;

    if (!userId) {
      throw new ForbiddenException(
        'Your account is inactive. Complete KYC verification to unlock this feature.',
      );
    }

    const user = await this.usersService.findById(userId);
    const isActive = user?.accountStatus === 'active';
    const isApproved = user?.kycStatus === 'approved';

    if (!isActive || !isApproved) {
      throw new ForbiddenException(
        'Your account is inactive. Complete KYC verification to unlock this feature.',
      );
    }

    return true;
  }
}
