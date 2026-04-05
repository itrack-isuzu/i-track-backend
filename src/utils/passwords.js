import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

export const hashPassword = async (password) => {
  const normalizedPassword = String(password ?? '');

  if (normalizedPassword.length < 8) {
    const error = new Error('Password must be at least 8 characters long.');
    error.statusCode = 400;
    throw error;
  }

  return bcrypt.hash(normalizedPassword, SALT_ROUNDS);
};

export const verifyPassword = async (password, passwordHash) =>
  bcrypt.compare(String(password ?? ''), String(passwordHash ?? ''));
