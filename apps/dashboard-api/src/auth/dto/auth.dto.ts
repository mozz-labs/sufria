import { createZodDto } from "nestjs-zod";
import { z } from "zod";

// Zod 4: z.email() مش z.string().email() — انظر ADR-003.
const LoginSchema = z.object({
  phoneOrEmail: z.string().trim().min(3).max(320),
  password: z.string().min(1).max(200),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(10),
});

export class LoginDto extends createZodDto(LoginSchema) {}
export class RefreshDto extends createZodDto(RefreshSchema) {}
