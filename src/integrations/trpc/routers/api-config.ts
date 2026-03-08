import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { userApiConfigs } from "#/db/schema";
import { decrypt, encrypt, maskApiKey } from "#/lib/crypto";
import { isReviewGuestReadOnlySession } from "#/lib/review-guest";
import { protectedProcedure, router } from "../init";

function assertGuestWriteAllowed(session: { user: { id: string } }) {
  if (isReviewGuestReadOnlySession(session)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Review guest mode is read-only",
    });
  }
}

export const apiConfigRouter = router({
  /**
   * Create a new API configuration
   * Encrypts API keys before storing
   * If isDefault=true, unsets other configs' default status
   */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        openaiApiKey: z.string().min(1),
        openaiBaseUrl: z.string().url(),
        openaiModel: z.string().min(1),
        geminiApiKey: z.string().min(1),
        geminiBaseUrl: z.string().url(),
        geminiModel: z.string().min(1),
        isDefault: z.boolean().optional().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertGuestWriteAllowed(ctx.session);

      const encryptionSecret = ctx.env.API_KEY_ENCRYPTION_SECRET;
      if (!encryptionSecret) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Encryption secret not configured",
        });
      }

      try {
        // Encrypt API keys
        const encryptedOpenaiKey = await encrypt(
          input.openaiApiKey,
          encryptionSecret,
        );
        const encryptedGeminiKey = await encrypt(
          input.geminiApiKey,
          encryptionSecret,
        );

        // If setting as default, unset other configs first
        if (input.isDefault) {
          await ctx.db
            .update(userApiConfigs)
            .set({ isDefault: false })
            .where(eq(userApiConfigs.userId, ctx.session.user.id));
        }

        // Create new config
        const [newConfig] = await ctx.db
          .insert(userApiConfigs)
          .values({
            userId: ctx.session.user.id,
            name: input.name,
            openaiApiKey: encryptedOpenaiKey,
            openaiBaseUrl: input.openaiBaseUrl,
            openaiModel: input.openaiModel,
            geminiApiKey: encryptedGeminiKey,
            geminiBaseUrl: input.geminiBaseUrl,
            geminiModel: input.geminiModel,
            isDefault: input.isDefault,
          })
          .returning({ id: userApiConfigs.id });

        return { id: newConfig.id };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        console.error("Failed to create API config:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create API configuration",
          cause: error,
        });
      }
    }),

  /**
   * List all API configurations for current user
   * API keys are masked for security
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const configs = await ctx.db
      .select()
      .from(userApiConfigs)
      .where(eq(userApiConfigs.userId, ctx.session.user.id))
      .orderBy(desc(userApiConfigs.createdAt));

    const encryptionSecret = ctx.env.API_KEY_ENCRYPTION_SECRET;
    if (!encryptionSecret) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Encryption secret not configured",
      });
    }

    // Decrypt and mask API keys
    const maskedConfigs = await Promise.all(
      configs.map(async (config) => {
        try {
          const decryptedOpenaiKey = await decrypt(
            config.openaiApiKey,
            encryptionSecret,
          );
          const decryptedGeminiKey = await decrypt(
            config.geminiApiKey,
            encryptionSecret,
          );

          return {
            ...config,
            openaiApiKey: maskApiKey(decryptedOpenaiKey),
            geminiApiKey: maskApiKey(decryptedGeminiKey),
          };
        } catch (error) {
          console.error(
            `Failed to decrypt keys for config ${config.id}:`,
            error,
          );
          return {
            ...config,
            openaiApiKey: "***",
            geminiApiKey: "***",
          };
        }
      }),
    );

    return maskedConfigs;
  }),

  /**
   * Get a single API configuration by ID
   * Verifies ownership and masks API keys
   */
  getById: protectedProcedure
    .input(z.string().uuid())
    .query(async ({ ctx, input }) => {
      const [config] = await ctx.db
        .select()
        .from(userApiConfigs)
        .where(
          and(
            eq(userApiConfigs.id, input),
            eq(userApiConfigs.userId, ctx.session.user.id),
          ),
        )
        .limit(1);

      if (!config) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "API configuration not found",
        });
      }

      const encryptionSecret = ctx.env.API_KEY_ENCRYPTION_SECRET;
      if (!encryptionSecret) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Encryption secret not configured",
        });
      }

      try {
        const decryptedOpenaiKey = await decrypt(
          config.openaiApiKey,
          encryptionSecret,
        );
        const decryptedGeminiKey = await decrypt(
          config.geminiApiKey,
          encryptionSecret,
        );

        return {
          ...config,
          openaiApiKey: maskApiKey(decryptedOpenaiKey),
          geminiApiKey: maskApiKey(decryptedGeminiKey),
        };
      } catch (error) {
        console.error(`Failed to decrypt keys for config ${config.id}:`, error);
        return {
          ...config,
          openaiApiKey: "***",
          geminiApiKey: "***",
        };
      }
    }),

  /**
   * Update an existing API configuration
   * Re-encrypts API keys if provided
   * Handles default status changes
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(100).optional(),
        openaiApiKey: z.string().min(1).optional(),
        openaiBaseUrl: z.string().url().optional(),
        openaiModel: z.string().min(1).optional(),
        geminiApiKey: z.string().min(1).optional(),
        geminiBaseUrl: z.string().url().optional(),
        geminiModel: z.string().min(1).optional(),
        isDefault: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertGuestWriteAllowed(ctx.session);

      // Verify ownership
      const [existingConfig] = await ctx.db
        .select()
        .from(userApiConfigs)
        .where(
          and(
            eq(userApiConfigs.id, input.id),
            eq(userApiConfigs.userId, ctx.session.user.id),
          ),
        )
        .limit(1);

      if (!existingConfig) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "API configuration not found",
        });
      }

      const encryptionSecret = ctx.env.API_KEY_ENCRYPTION_SECRET;
      if (!encryptionSecret) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Encryption secret not configured",
        });
      }

      try {
        // Prepare update data
        const updateData: Record<string, unknown> = {
          updatedAt: new Date(),
        };

        if (input.name !== undefined) {
          updateData.name = input.name;
        }

        if (input.openaiApiKey !== undefined) {
          updateData.openaiApiKey = await encrypt(
            input.openaiApiKey,
            encryptionSecret,
          );
        }

        if (input.openaiBaseUrl !== undefined) {
          updateData.openaiBaseUrl = input.openaiBaseUrl;
        }

        if (input.openaiModel !== undefined) {
          updateData.openaiModel = input.openaiModel;
        }

        if (input.geminiApiKey !== undefined) {
          updateData.geminiApiKey = await encrypt(
            input.geminiApiKey,
            encryptionSecret,
          );
        }

        if (input.geminiBaseUrl !== undefined) {
          updateData.geminiBaseUrl = input.geminiBaseUrl;
        }

        if (input.geminiModel !== undefined) {
          updateData.geminiModel = input.geminiModel;
        }

        if (input.isDefault !== undefined) {
          updateData.isDefault = input.isDefault;

          // If setting as default, unset other configs first
          if (input.isDefault) {
            await ctx.db
              .update(userApiConfigs)
              .set({ isDefault: false })
              .where(
                and(
                  eq(userApiConfigs.userId, ctx.session.user.id),
                  // Don't update the current config yet
                ),
              );
          }
        }

        await ctx.db
          .update(userApiConfigs)
          .set(updateData)
          .where(eq(userApiConfigs.id, input.id));

        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        console.error("Failed to update API config:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update API configuration",
          cause: error,
        });
      }
    }),

  /**
   * Delete an API configuration
   * Verifies ownership before deletion
   */
  delete: protectedProcedure
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      assertGuestWriteAllowed(ctx.session);

      const result = await ctx.db
        .delete(userApiConfigs)
        .where(
          and(
            eq(userApiConfigs.id, input),
            eq(userApiConfigs.userId, ctx.session.user.id),
          ),
        )
        .returning();

      if (result.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "API configuration not found",
        });
      }

      return { success: true };
    }),

  /**
   * Test API configuration
   * Tests both OpenAI and Gemini APIs with simple requests
   * Can test saved config by ID or temporary config
   */
  test: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid().optional(),
        openaiApiKey: z.string().min(1).optional(),
        openaiBaseUrl: z.string().url().optional(),
        openaiModel: z.string().min(1).optional(),
        geminiApiKey: z.string().min(1).optional(),
        geminiBaseUrl: z.string().url().optional(),
        geminiModel: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let openaiConfig: {
        apiKey: string;
        baseUrl: string;
        model: string;
      } | null = null;
      let geminiConfig: {
        apiKey: string;
        baseUrl: string;
        model: string;
      } | null = null;

      // Load config from database if ID provided
      if (input.id) {
        const [config] = await ctx.db
          .select()
          .from(userApiConfigs)
          .where(
            and(
              eq(userApiConfigs.id, input.id),
              eq(userApiConfigs.userId, ctx.session.user.id),
            ),
          )
          .limit(1);

        if (!config) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "API configuration not found",
          });
        }

        const encryptionSecret = ctx.env.API_KEY_ENCRYPTION_SECRET;
        if (!encryptionSecret) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Encryption secret not configured",
          });
        }

        try {
          const decryptedOpenaiKey = await decrypt(
            config.openaiApiKey,
            encryptionSecret,
          );
          const decryptedGeminiKey = await decrypt(
            config.geminiApiKey,
            encryptionSecret,
          );

          openaiConfig = {
            apiKey: decryptedOpenaiKey,
            baseUrl: config.openaiBaseUrl,
            model: config.openaiModel,
          };

          geminiConfig = {
            apiKey: decryptedGeminiKey,
            baseUrl: config.geminiBaseUrl,
            model: config.geminiModel,
          };
        } catch (error) {
          console.error("Failed to decrypt API keys:", error);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to decrypt API keys",
          });
        }
      } else {
        // Use temporary config from input
        if (input.openaiApiKey && input.openaiBaseUrl && input.openaiModel) {
          openaiConfig = {
            apiKey: input.openaiApiKey,
            baseUrl: input.openaiBaseUrl,
            model: input.openaiModel,
          };
        }

        if (input.geminiApiKey && input.geminiBaseUrl && input.geminiModel) {
          geminiConfig = {
            apiKey: input.geminiApiKey,
            baseUrl: input.geminiBaseUrl,
            model: input.geminiModel,
          };
        }
      }

      // Test both APIs in parallel
      const [openaiResult, geminiResult] = await Promise.all([
        openaiConfig ? testOpenAI(openaiConfig) : Promise.resolve(null),
        geminiConfig ? testGemini(geminiConfig) : Promise.resolve(null),
      ]);

      // Update database if testing saved config
      if (input.id) {
        const updateData: Record<string, unknown> = {
          lastTestedAt: new Date(),
        };

        if (openaiResult) {
          updateData.openaiTestStatus = openaiResult.status;
        }

        if (geminiResult) {
          updateData.geminiTestStatus = geminiResult.status;
        }

        await ctx.db
          .update(userApiConfigs)
          .set(updateData)
          .where(eq(userApiConfigs.id, input.id));
      }

      // Build response
      const response: {
        openaiStatus?: "success" | "failed";
        geminiStatus?: "success" | "failed";
        errors?: {
          openai?: string;
          gemini?: string;
        };
      } = {};

      if (openaiResult) {
        response.openaiStatus = openaiResult.status;
        if (openaiResult.error) {
          response.errors = response.errors || {};
          response.errors.openai = openaiResult.error;
        }
      }

      if (geminiResult) {
        response.geminiStatus = geminiResult.status;
        if (geminiResult.error) {
          response.errors = response.errors || {};
          response.errors.gemini = geminiResult.error;
        }
      }

      return response;
    }),
});

/**
 * Test OpenAI API with a simple request
 */
async function testOpenAI(config: {
  apiKey: string;
  baseUrl: string;
  model: string;
}): Promise<{ status: "success" | "failed"; error?: string }> {
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: "test" }],
        max_tokens: 5,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `API error: ${response.status}`;

      try {
        const errorData = JSON.parse(errorText) as {
          error?: { message?: string };
        };
        if (errorData.error?.message) {
          errorMessage = errorData.error.message;
        }
      } catch {
        // If parsing fails, use status text
        errorMessage = `${response.status} ${response.statusText}`;
      }

      return {
        status: "failed",
        error: errorMessage,
      };
    }

    return { status: "success" };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Test Gemini API with a simple request
 */
async function testGemini(config: {
  apiKey: string;
  baseUrl: string;
  model: string;
}): Promise<{ status: "success" | "failed"; error?: string }> {
  try {
    const response = await fetch(
      `${config.baseUrl}/models/${config.model}:generateContent?key=${config.apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "test" }] }],
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `API error: ${response.status}`;

      try {
        const errorData = JSON.parse(errorText) as {
          error?: { message?: string };
        };
        if (errorData.error?.message) {
          errorMessage = errorData.error.message;
        }
      } catch {
        // If parsing fails, use status text
        errorMessage = `${response.status} ${response.statusText}`;
      }

      return {
        status: "failed",
        error: errorMessage,
      };
    }

    return { status: "success" };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
