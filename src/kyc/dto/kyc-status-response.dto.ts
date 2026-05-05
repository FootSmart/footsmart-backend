export class KycStatusResponseDto {
  accountStatus: string;
  kycStatus: string;
  provider?: string | null;
  verifiedAt?: Date | string | null;
  rejectionReason?: string | null;
}
