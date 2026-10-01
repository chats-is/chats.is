ALTER TABLE "payment" RENAME COLUMN "amount_refunded" TO "refund_amount";--> statement-breakpoint
ALTER TABLE "payment" RENAME COLUMN "refunded_by" TO "refund_by";--> statement-breakpoint
ALTER TABLE "payment" RENAME CONSTRAINT "payment_refunded_by_user_id_fk" TO "payment_refund_by_user_id_fk";--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "refund_fee" varchar(8);--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "refund_at" timestamp with time zone;