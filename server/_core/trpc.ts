import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "@shared/const";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { clientSafeMessage } from "../security/http";

const isDev = process.env.NODE_ENV !== "production";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  isDev,
  // Production clients never receive stack traces, SQL or driver messages (they are logged instead).
  errorFormatter({ shape, error }) {
    // Evaluated per error (not at import) so tests and runtime agree on the environment.
    const { stack, ...data } = shape.data;
    return {
      ...shape,
      message: clientSafeMessage(error.code, error.message, error.cause),
      data: process.env.NODE_ENV !== "production" ? { ...data, stack } : data,
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

// While an account still uses an administrator-issued one-time password, the only
// authenticated action allowed is replacing it (auth.me / auth.logout are public).
const PASSWORD_CHANGE_ALLOWED_PATHS = new Set(["auth.changePassword"]);
const PASSWORD_CHANGE_REQUIRED_MSG =
  "Сначала замените временный пароль на собственный";
const assertPasswordChanged = (
  user: { mustChangePassword?: boolean | null },
  path: string
) => {
  if (user.mustChangePassword && !PASSWORD_CHANGE_ALLOWED_PATHS.has(path)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: PASSWORD_CHANGE_REQUIRED_MSG,
    });
  }
};

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  assertPasswordChanged(ctx.user, opts.path);

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (
      !ctx.user ||
      String(ctx.user.role ?? "")
        .trim()
        .toLowerCase() !== "admin"
    ) {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    assertPasswordChanged(ctx.user, opts.path);

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  })
);
