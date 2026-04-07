import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;
const PASSWORD_COMPLEXITY_REGEX =
  /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
const PASSWORD_REQUIREMENTS_MESSAGE =
  'Password must be at least 8 characters and include at least 1 uppercase letter, 1 number, and 1 special character.';

const UPPERCASE_CHARACTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWERCASE_CHARACTERS = 'abcdefghijkmnopqrstuvwxyz';
const DIGIT_CHARACTERS = '23456789';
const SPECIAL_CHARACTERS = '!@#$%&*?';
const MIXED_PASSWORD_CHARACTERS = `${UPPERCASE_CHARACTERS}${LOWERCASE_CHARACTERS}${DIGIT_CHARACTERS}${SPECIAL_CHARACTERS}`;

const randomCharacterFrom = (charset) =>
  charset[Math.floor(Math.random() * charset.length)];

const shuffleCharacters = (value) => {
  const next = [...value];

  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const current = next[index];

    next[index] = next[swapIndex];
    next[swapIndex] = current;
  }

  return next;
};

export const generateTemporaryPassword = () =>
  shuffleCharacters([
    randomCharacterFrom(UPPERCASE_CHARACTERS),
    randomCharacterFrom(LOWERCASE_CHARACTERS),
    randomCharacterFrom(DIGIT_CHARACTERS),
    randomCharacterFrom(SPECIAL_CHARACTERS),
    randomCharacterFrom(MIXED_PASSWORD_CHARACTERS),
    randomCharacterFrom(MIXED_PASSWORD_CHARACTERS),
    randomCharacterFrom(MIXED_PASSWORD_CHARACTERS),
    randomCharacterFrom(MIXED_PASSWORD_CHARACTERS),
    randomCharacterFrom(MIXED_PASSWORD_CHARACTERS),
    randomCharacterFrom(MIXED_PASSWORD_CHARACTERS),
  ]).join('');

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
