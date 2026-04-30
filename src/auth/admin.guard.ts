import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './users/entities/user.entity';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authUser = request.user as { id?: string } | undefined;

    if (!authUser?.id) {
      throw new UnauthorizedException('Missing authenticated user');
    }

    const user = await this.usersRepository.findOne({
      where: { id: authUser.id },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.role !== 'admin') {
      throw new ForbiddenException('Admin access required');
    }

    if (user.accountStatus !== 'active') {
      throw new ForbiddenException('Admin account is not active');
    }

    request.user = {
      id: user.id,
      email: user.email,
      role: user.role,
    };
    return true;
  }
}
