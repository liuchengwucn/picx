import { db } from "./index";
import { creditTransactions } from "./schema";

export async function initializeUserCredits(userId: string) {
	await db.insert(creditTransactions).values({
		userId,
		amount: 10,
		type: "initial",
		description: "注册赠送",
	});
}
