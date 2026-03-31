import { Controller, Get, UseGuards, Request, NotFoundException, Put, Body } from '@nestjs/common';
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
}
