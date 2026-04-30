import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {}

  async findByEmail(email: string) {
    return this.usersRepository.findOne({ where: { email } });
  }

  async create(userData: Partial<User>) {
    const user = this.usersRepository.create(userData);
    return this.usersRepository.save(user);
  }

  async findById(id: string) {
    return this.usersRepository.findOne({ where: { id } });
  }

  async updatePassword(id: string, passwordHash: string) {
    return this.usersRepository.update({ id }, { passwordHash });
  }

  async updateProfile(id: string, updates: UpdateProfileDto) {
    const payload: Partial<User> = {};

    if (updates.displayName !== undefined) payload.displayName = updates.displayName;
    if (updates.email !== undefined) payload.email = updates.email;
    if (updates.country !== undefined) payload.country = updates.country;
    if (updates.avatarUrl !== undefined) payload.avatarUrl = updates.avatarUrl;
    if (updates.club !== undefined) payload.club = updates.club;
    if (updates.dateOfBirth !== undefined) {
      const raw = updates.dateOfBirth.trim();
      if (raw.length > 0) {
        // Accepte YYYY-MM-DD (ISO) et DD-MM-YYYY (UI actuelle)
        const ddmmyyyy = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
        const normalized = ddmmyyyy
          ? `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`
          : raw;

        const d = new Date(normalized);
        if (!Number.isNaN(d.getTime())) {
          payload.dateOfBirth = d;
        }
      }
    }

    if (updates.subscriptionActive !== undefined) {
      payload.subscriptionActive = updates.subscriptionActive;
    }

    if (updates.subscriptionPlan !== undefined) {
      payload.subscriptionPlan = updates.subscriptionPlan;
    }

    if (updates.subscriptionEndsAt !== undefined) {
      payload.subscriptionEndsAt = updates.subscriptionEndsAt
        ? new Date(updates.subscriptionEndsAt)
        : null;
    }

    await this.usersRepository.update({ id }, payload);
    return this.findById(id);
  }

  async updateSubscription(
    id: string,
    data : {
      subscriptionActive: boolean;
      subscriptionPlan?: string | null;
      subscriptionEndsAt?: Date | null;
    },
  ) {
    await this.usersRepository.update(
      { id },
      {
        subscriptionActive: data.subscriptionActive,
        subscriptionPlan: data.subscriptionPlan ?? null,
        subscriptionEndsAt: data.subscriptionEndsAt ?? null,
      },
    );
    return this.findById(id);
  }
}
