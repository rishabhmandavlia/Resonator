import React from "react";
import { Check, X } from "lucide-react";

export const PASSWORD_MIN_LENGTH = 12;

const BASE_RULE_ERROR_MESSAGES = {
  length: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
  uppercase: "Password must contain at least one uppercase letter",
  lowercase: "Password must contain at least one lowercase letter",
  number: "Password must contain at least one number",
  special: "Password must contain at least one special character",
  noSpaces: "Password cannot contain spaces",
} as const;

const COMMON_PASSWORDS = new Set([
  "password",
  "password123",
  "12345678",
  "qwerty",
  "111111",
]);

const BASE_RULE_MESSAGES = new Set<string>(
  Object.values(BASE_RULE_ERROR_MESSAGES),
);

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
  strength: "Weak" | "Medium" | "Strong" | "";
  conditions: {
    length: boolean;
    uppercase: boolean;
    lowercase: boolean;
    number: boolean;
    special: boolean;
    noSpaces: boolean;
  };
}

export function validatePassword(
  password: string,
  email?: string,
): PasswordValidationResult {
  if (!password) {
    return {
      valid: false,
      errors: ["Password is required"],
      strength: "",
      conditions: {
        length: false,
        uppercase: false,
        lowercase: false,
        number: false,
        special: false,
        noSpaces: false,
      },
    };
  }

  const length = password.length >= PASSWORD_MIN_LENGTH;
  const uppercase = /[A-Z]/.test(password);
  const lowercase = /[a-z]/.test(password);
  const number = /[0-9]/.test(password);
  const special = /[!@#$%^&*()[\]{}\-_=+|:;"'<>,./?]/.test(password);
  const noSpaces = !/\s/.test(password);

  const errors: string[] = [];
  if (!length) errors.push(BASE_RULE_ERROR_MESSAGES.length);
  if (!uppercase)
    errors.push(BASE_RULE_ERROR_MESSAGES.uppercase);
  if (!lowercase)
    errors.push(BASE_RULE_ERROR_MESSAGES.lowercase);
  if (!number) errors.push(BASE_RULE_ERROR_MESSAGES.number);
  if (!special)
    errors.push(BASE_RULE_ERROR_MESSAGES.special);
  if (!noSpaces) errors.push(BASE_RULE_ERROR_MESSAGES.noSpaces);

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    errors.push("Password is too common");
  }

  if (email) {
    const emailPrefix = email.split("@")[0].toLowerCase();
    if (
      emailPrefix.length >= 3 &&
      password.toLowerCase().includes(emailPrefix)
    ) {
      errors.push("Password cannot contain your email prefix");
    }
  }

  const valid =
    length &&
    uppercase &&
    lowercase &&
    number &&
    special &&
    noSpaces &&
    errors.length === 0;

  let strength: "Weak" | "Medium" | "Strong" = "Weak";
  const conditionsMet = [
    length,
    uppercase,
    lowercase,
    number,
    special,
    noSpaces,
  ].filter(Boolean).length;
  if (valid && password.length >= 16) {
    strength = "Strong";
  } else if (valid || conditionsMet >= 5) {
    strength = "Medium";
  }

  return {
    valid,
    errors,
    strength,
    conditions: {
      length,
      uppercase,
      lowercase,
      number,
      special,
        noSpaces,
    },
  };
}

export function PasswordValidator({
  validation,
}: {
  validation: PasswordValidationResult;
}) {
  const hasStarted =
    Object.values(validation.conditions).some(Boolean) ||
    validation.errors.some((error) => error !== "Password is required");

  if (!hasStarted) return null;

  const additionalErrors = validation.errors.filter(
    (error) => !BASE_RULE_MESSAGES.has(error),
  );

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-700">
          Password strength:
        </span>
        <span
          className={`text-sm font-bold ${
            validation.strength === "Strong"
              ? "text-emerald-600"
              : validation.strength === "Medium"
                ? "text-amber-600"
                : "text-red-600"
          }`}
        >
          {validation.strength || "Weak"}
        </span>
      </div>

      <div className="space-y-2">
        <ConditionItem
          met={validation.conditions.length}
          text={`At least ${PASSWORD_MIN_LENGTH} characters`}
        />
        <ConditionItem
          met={validation.conditions.uppercase}
          text="One uppercase letter"
        />
        <ConditionItem
          met={validation.conditions.lowercase}
          text="One lowercase letter"
        />
        <ConditionItem met={validation.conditions.number} text="One number" />
        <ConditionItem
          met={validation.conditions.special}
          text="One special character"
        />
        <ConditionItem met={validation.conditions.noSpaces} text="No spaces" />
      </div>

      {additionalErrors.length > 0 && (
        <div className="space-y-1 rounded-md border border-amber-200 bg-amber-50 p-3">
          {additionalErrors.map((error) => (
            <p key={error} className="text-sm text-amber-900">
              {error}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function ConditionItem({ met, text }: { met: boolean; text: string }) {
  return (
    <div className="flex items-center gap-2">
      {met ? (
        <Check className="h-4 w-4 text-emerald-500" />
      ) : (
        <X className="h-4 w-4 text-slate-300" />
      )}
      <span className={`text-sm ${met ? "text-slate-700" : "text-slate-500"}`}>
        {text}
      </span>
    </div>
  );
}
