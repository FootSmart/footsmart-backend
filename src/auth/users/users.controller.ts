import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  NotFoundException,
  Put,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtGuard } from '../jwt.guard';
import { UpdateProfileDto } from './dto/update-profile.dto';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get current authenticated user' })
  async getCurrentUser(@Request() req: any) {
    const user = await this.usersService.findById(req.user.id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    // Remove sensitive fields
    const { passwordHash, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  @Put('me')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update current authenticated user profile' })
  async updateCurrentUser(@Request() req: any, @Body() updateProfileDto: UpdateProfileDto) {
    const updatedUser = await this.usersService.updateProfile(req.user.id, updateProfileDto);
    if (!updatedUser) {
      throw new NotFoundException('User not found');
    }
    const { passwordHash, ...userWithoutPassword } = updatedUser;
    return userWithoutPassword;
  }

  @Put('me/avatar')
  @UseGuards(JwtGuard)
  @ApiBearerAuth('JWT-auth')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dest = join(process.cwd(), 'uploads', 'avatars');
          mkdirSync(dest, { recursive: true });
          cb(null, dest);
        },
        filename: (req: any, file, cb) => {
          const safeExt = extname(file.originalname || '').toLowerCase() || '.jpg';
          cb(null, `${req.user.id}-${Date.now()}${safeExt}`);
        },
      }),
      fileFilter: (_req, file, cb) => {
        const ok = /^image\//.test(file.mimetype);
        cb(ok ? null : new Error('Only image files are allowed'), ok);
      },
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  @ApiOperation({ summary: 'Upload avatar for current user' })
  async uploadAvatar(@Request() req: any, @UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new NotFoundException('File is required');
    }

    // IMPORTANT: sur Android emulator, "localhost" pointe vers le téléphone.
    // On préfère PUBLIC_BASE_URL, sinon on dérive depuis l'host de la requête (ex: 10.0.2.2:3007).
    const host = req?.headers?.host as string | undefined;
    const inferredBaseUrl = host ? `http://${host}` : undefined;
    const publicBaseUrl =
      process.env.PUBLIC_BASE_URL ||
      inferredBaseUrl ||
      `http://localhost:${process.env.PORT ?? 3001}`;
    const avatarUrl = `${publicBaseUrl}/uploads/avatars/${file.filename}`;

    const updatedUser = await this.usersService.updateProfile(req.user.id, {
      avatarUrl,
    } as any);
    if (!updatedUser) throw new NotFoundException('User not found');

    const { passwordHash, ...userWithoutPassword } = updatedUser;
    return userWithoutPassword;
  }
}
