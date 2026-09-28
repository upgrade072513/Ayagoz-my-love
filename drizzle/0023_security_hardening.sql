CREATE TABLE `rateLimits` (
	`key` varchar(128) NOT NULL,
	`count` int NOT NULL DEFAULT 0,
	`resetAtMs` bigint NOT NULL,
	CONSTRAINT `rateLimits_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
ALTER TABLE `invoiceItems` ADD CONSTRAINT `invoiceItems_accrualId_unique` UNIQUE(`accrualId`);