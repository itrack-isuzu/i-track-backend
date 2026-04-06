import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;
const PASSWORD_COMPLEXITY_REGEX =
  /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
const PASSWORD_REQUIREMENTS_MESSAGE =
  'Password must be at least 8 characters and include at least 1 uppercase letter, 1 number, and 1 special character.';

export const hashPassword = async (password) => {
  const normalizedPassword = String(password ?? '');

  if (!PASSWORD_COMPLEXITY_REGEX.test(normalizedPassword)) {
    const error = new Error(PASSWORD_REQUIREMENTS_MESSAGE);
    error.statusCode = 400;
    throw error;
  }

  return bcrypt.hash(normalizedPassword, SALT_ROUNDS);
};

export const verifyPassword = async (password, passwordHash) =>
  bcrypt.compare(String(password ?? ''), String(passwordHash ?? ''));
