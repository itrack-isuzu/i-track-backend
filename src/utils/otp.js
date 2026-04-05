import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';

export const OTP_CODE_LENGTH = 6;
const OTP_SALT_ROUNDS = 8;

export const normalizeOtpCode = (otpCode) =>
  String(otpCode ?? '')
    .replace(/\D/g, '')
    .slice(0, OTP_CODE_LENGTH);

export const createOtpCode = () =>
  randomInt(0, 10 ** OTP_CODE_LENGTH)
    .toString()
    .padStart(OTP_CODE_LENGTH, '0');

export const hashOtpCode = async (otpCode) =>
  bcrypt.hash(normalizeOtpCode(otpCode), OTP_SALT_ROUNDS);

export const verifyOtpCode = async (otpCode, otpHash) =>
  bcrypt.compare(normalizeOtpCode(otpCode), String(otpHash ?? ''));
