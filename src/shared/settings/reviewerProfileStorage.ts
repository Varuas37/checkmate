const STORAGE_KEY = "codelens-reviewer-profile.v1";

export interface ReviewerProfile {
  readonly name: string;
  readonly email: string;
}

function normalizeValue(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function isValidProfile(input: Partial<ReviewerProfile> | null | undefined): input is ReviewerProfile {
  if (!input) {
    return false;
  }

  const name = normalizeValue(input.name);
  const email = normalizeValue(input.email);
  return name.length > 0 && email.length > 0;
}

export function readReviewerProfileFromStorage(): ReviewerProfile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<ReviewerProfile>;
    if (!isValidProfile(parsed)) {
      return null;
    }

    return {
      name: parsed.name.trim(),
      email: parsed.email.trim(),
    };
  } catch {
    return null;
  }
}

export function writeReviewerProfileToStorage(profile: ReviewerProfile): void {
  const normalized: ReviewerProfile = {
    name: profile.name.trim(),
    email: profile.email.trim(),
  };

  if (!isValidProfile(normalized)) {
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Ignore write failures (e.g., storage unavailable in private mode).
  }
}

export function clearReviewerProfileFromStorage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore failures.
  }
}
