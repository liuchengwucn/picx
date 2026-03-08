import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schema from "#/db/schema";
import { creditTransactions, user } from "#/db/schema";

const reviewEnv = import.meta.env as ImportMetaEnv &
  Record<string, string | undefined>;

type SessionLike = {
  user?: {
    id?: string | null;
  } | null;
} | null | undefined;

function isTruthy(value: string | undefined) {
  return value === "1" || value === "true";
}

function toDate(value: Date | number) {
  return value instanceof Date ? value : new Date(value);
}

export const REVIEW_GUEST_USER_ID =
  reviewEnv.VITE_REVIEW_GUEST_USER_ID || "review-guest-user";

const REVIEW_GUEST_NAME = reviewEnv.VITE_REVIEW_GUEST_NAME || "Review Guest";
const REVIEW_GUEST_EMAIL =
  reviewEnv.VITE_REVIEW_GUEST_EMAIL || "review-guest@picx.local";
const REVIEW_GUEST_MIN_CREDITS = Math.max(
  Number.parseInt(reviewEnv.VITE_REVIEW_GUEST_CREDITS || "999", 10) || 999,
  1,
);

export type ReviewGuestSession = {
  session: {
    id: string;
    expiresAt: Date;
    token: string;
    createdAt: Date;
    updatedAt: Date;
    userId: string;
    ipAddress: string | null;
    userAgent: string | null;
  };
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    image: string | null;
    credits: number;
    createdAt: Date;
    updatedAt: Date;
  };
};

export function isReviewGuestModeEnabled() {
  return reviewEnv.VITE_ENABLE_REVIEW_GUEST === undefined
    ? false
    : isTruthy(reviewEnv.VITE_ENABLE_REVIEW_GUEST);
}

export function isReviewGuestMutationsEnabled() {
  return isTruthy(reviewEnv.VITE_REVIEW_GUEST_MUTATIONS_ENABLED);
}

export function isReviewGuestSession(session: SessionLike) {
  return isReviewGuestModeEnabled() && session?.user?.id === REVIEW_GUEST_USER_ID;
}

export function isReviewGuestReadOnlySession(session: SessionLike) {
  return isReviewGuestSession(session) && !isReviewGuestMutationsEnabled();
}

function createReviewGuestSession(guestUser: {
  id: string;
  name: string;
  email: string;
  emailVerified: number | null;
  image: string | null;
  credits: number;
  createdAt: Date | number;
  updatedAt: Date | number;
}): ReviewGuestSession {
  return {
    session: {
      id: "review-guest-session",
      expiresAt: new Date("2099-12-31T23:59:59.999Z"),
      token: "review-guest-token",
      createdAt: new Date(0),
      updatedAt: new Date(),
      userId: guestUser.id,
      ipAddress: null,
      userAgent: "review-guest",
    },
    user: {
      id: guestUser.id,
      name: guestUser.name,
      email: guestUser.email,
      emailVerified: Boolean(guestUser.emailVerified),
      image: guestUser.image,
      credits: guestUser.credits,
      createdAt: toDate(guestUser.createdAt),
      updatedAt: toDate(guestUser.updatedAt),
    },
  };
}

export function getReviewGuestClientSession(): ReviewGuestSession {
  const now = new Date();

  return createReviewGuestSession({
    id: REVIEW_GUEST_USER_ID,
    name: REVIEW_GUEST_NAME,
    email: REVIEW_GUEST_EMAIL,
    emailVerified: 1,
    image: null,
    credits: REVIEW_GUEST_MIN_CREDITS,
    createdAt: now,
    updatedAt: now,
  });
}

async function ensureReviewGuestUser(db: DrizzleD1Database<typeof schema>) {
  const [existingUser] = await db
    .select()
    .from(user)
    .where(eq(user.id, REVIEW_GUEST_USER_ID))
    .limit(1);

  if (!existingUser) {
    const now = new Date();

    await db.insert(user).values({
      id: REVIEW_GUEST_USER_ID,
      name: REVIEW_GUEST_NAME,
      email: REVIEW_GUEST_EMAIL,
      emailVerified: 1,
      image: null,
      credits: REVIEW_GUEST_MIN_CREDITS,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(creditTransactions).values({
      userId: REVIEW_GUEST_USER_ID,
      amount: REVIEW_GUEST_MIN_CREDITS,
      type: "purchase",
      description: "Review mode guest credits",
    });

    const [createdUser] = await db
      .select()
      .from(user)
      .where(eq(user.id, REVIEW_GUEST_USER_ID))
      .limit(1);

    if (!createdUser) {
      throw new Error("Failed to create review guest user");
    }

    return createdUser;
  }

  if (existingUser.credits < REVIEW_GUEST_MIN_CREDITS) {
    const creditsToAdd = REVIEW_GUEST_MIN_CREDITS - existingUser.credits;

    await db
      .update(user)
      .set({
        credits: REVIEW_GUEST_MIN_CREDITS,
        updatedAt: new Date(),
      })
      .where(eq(user.id, REVIEW_GUEST_USER_ID));

    await db.insert(creditTransactions).values({
      userId: REVIEW_GUEST_USER_ID,
      amount: creditsToAdd,
      type: "purchase",
      description: "Review mode guest top-up",
    });

    return {
      ...existingUser,
      credits: REVIEW_GUEST_MIN_CREDITS,
      updatedAt: new Date(),
    };
  }

  return existingUser;
}

export async function getReviewGuestServerSession(
  db: DrizzleD1Database<typeof schema>,
): Promise<ReviewGuestSession> {
  const guestUser = await ensureReviewGuestUser(db);
  return createReviewGuestSession(guestUser);
}
