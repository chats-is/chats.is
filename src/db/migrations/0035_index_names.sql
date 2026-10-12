-- Each index named for its table and every column it is on, in full. Renamed
-- rather than built again: the same index under its new name, at once.
ALTER INDEX "usage_user_created_idx" RENAME TO "usage_user_id_created_at_idx";--> statement-breakpoint
ALTER INDEX "subscription_status_created_idx" RENAME TO "subscription_status_created_at_idx";--> statement-breakpoint
ALTER INDEX "refund_request_status_idx" RENAME TO "refund_request_status_created_at_idx";--> statement-breakpoint
ALTER INDEX "payment_transaction_idx" RENAME TO "payment_processor_transaction_id_idx";--> statement-breakpoint
ALTER INDEX "payment_refund_request_idx" RENAME TO "payment_refund_request_id_idx";--> statement-breakpoint
ALTER INDEX "plan_processor_price_idx" RENAME TO "plan_processor_price_id_idx";--> statement-breakpoint
ALTER INDEX "subscription_processor_external_idx" RENAME TO "subscription_processor_external_id_idx";--> statement-breakpoint
ALTER INDEX "payment_processor_external_idx" RENAME TO "payment_processor_external_id_idx";--> statement-breakpoint
ALTER INDEX "model_provider_model_provider_idx" RENAME TO "model_provider_model_id_provider_id_idx";--> statement-breakpoint
ALTER INDEX "model_provider_priority_idx" RENAME TO "model_provider_model_id_priority_idx";--> statement-breakpoint
ALTER INDEX "subscription_user_live_idx" RENAME TO "subscription_user_id_live_idx";--> statement-breakpoint
ALTER INDEX "refund_request_pending_idx" RENAME TO "refund_request_subscription_id_pending_idx";