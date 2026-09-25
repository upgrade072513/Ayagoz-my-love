ALTER TABLE `paymentAudit` MODIFY COLUMN `paymentId` int;--> statement-breakpoint
ALTER TABLE `paymentAudit` MODIFY COLUMN `action` enum('recorded','reversed','status_changed') NOT NULL;--> statement-breakpoint
ALTER TABLE `paymentAudit` ADD `previousStatus` varchar(32);--> statement-breakpoint
ALTER TABLE `paymentAudit` ADD `newStatus` varchar(32);