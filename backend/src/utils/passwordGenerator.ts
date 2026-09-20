/**
 * Password Generator & Strength Evaluator Utility
 * Generates cryptographically secure passwords and evaluates complexity.
 */

export interface PasswordGeneratorOptions {
  length?: number;
  includeUppercase?: boolean;
  includeLowercase?: boolean;
  includeNumbers?: boolean;
  includeSymbols?: boolean;
  avoidAmbiguous?: boolean; // Avoid characters like 1, l, I, 0, O, o
}

const UPPERCASE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // without ambiguous if avoided
const LOWERCASE_CHARS = "abcdefghijkmnopqrstuvwxyz";
const NUMBER_CHARS = "23456789";
const SYMBOL_CHARS = "!@#$%^&*()_+-=[]{}|;:,.<>?";

const FULL_UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const FULL_LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
const FULL_NUMBERS = "0123456789";
const FULL_SYMBOLS = "!@#$%^&*()_+-=[]{}|;:,.<>?";

/**
 * Generates a cryptographically secure random password.
 */
export function generatePassword(options: PasswordGeneratorOptions = {}): string {
  const {
    length = 16,
    includeUppercase = true,
    includeLowercase = true,
    includeNumbers = true,
    includeSymbols = true,
    avoidAmbiguous = true,
  } = options;

  const upper = avoidAmbiguous ? UPPERCASE_CHARS : FULL_UPPERCASE;
  const lower = avoidAmbiguous ? LOWERCASE_CHARS : FULL_LOWERCASE;
  const numbers = avoidAmbiguous ? NUMBER_CHARS : FULL_NUMBERS;
  const symbols = avoidAmbiguous ? SYMBOL_CHARS : FULL_SYMBOLS;

  let charPool = "";
  const guaranteedChars: string[] = [];

  const getRandomChar = (str: string) => {
    const randomIndex = Math.floor(Math.random() * str.length);
    return str[randomIndex];
  };

  if (includeUppercase) {
    charPool += upper;
    guaranteedChars.push(getRandomChar(upper));
  }
  if (includeLowercase) {
    charPool += lower;
    guaranteedChars.push(getRandomChar(lower));
  }
  if (includeNumbers) {
    charPool += numbers;
    guaranteedChars.push(getRandomChar(numbers));
  }
  if (includeSymbols) {
    charPool += symbols;
    guaranteedChars.push(getRandomChar(symbols));
  }

  if (charPool.length === 0) {
    charPool = lower + numbers;
    guaranteedChars.push(getRandomChar(lower));
    guaranteedChars.push(getRandomChar(numbers));
  }

  const result: string[] = [...guaranteedChars];
  const targetLength = Math.max(length, guaranteedChars.length);

  while (result.length < targetLength) {
    result.push(getRandomChar(charPool));
  }

  // Fisher-Yates shuffle
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result.join("");
}

export interface PasswordStrengthResult {
  score: number; // 0 to 4
  level: "very_weak" | "weak" | "fair" | "good" | "strong";
  hasMinLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
  hasSymbol: boolean;
  feedback: string[];
}

/**
 * Evaluates password strength and criteria compliance.
 */
export function evaluatePasswordStrength(password: string): PasswordStrengthResult {
  const hasMinLength = password.length >= 8;
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);

  const criteriaMet = [
    hasMinLength,
    hasUppercase,
    hasLowercase,
    hasNumber,
    hasSymbol,
  ].filter(Boolean).length;

  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (hasUppercase && hasLowercase) score++;
  if (hasNumber && hasSymbol) score++;

  const feedback: string[] = [];
  if (!hasMinLength) feedback.push("At least 8 characters required");
  if (!hasUppercase) feedback.push("Include at least one uppercase letter");
  if (!hasLowercase) feedback.push("Include at least one lowercase letter");
  if (!hasNumber) feedback.push("Include at least one number");
  if (!hasSymbol) feedback.push("Include at least one special character");

  let level: PasswordStrengthResult["level"] = "very_weak";
  if (score === 1) level = "weak";
  else if (score === 2) level = "fair";
  else if (score === 3) level = "good";
  else if (score >= 4) level = "strong";

  return {
    score,
    level,
    hasMinLength,
    hasUppercase,
    hasLowercase,
    hasNumber,
    hasSymbol,
    feedback,
  };
}
