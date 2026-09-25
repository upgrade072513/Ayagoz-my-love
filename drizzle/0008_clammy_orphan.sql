ALTER TABLE `accruals` MODIFY COLUMN `contractId` int;--> statement-breakpoint
ALTER TABLE `accruals` ADD `tenantName` varchar(255);--> statement-breakpoint
ALTER TABLE `accruals` ADD `tenantEmail` varchar(320);--> statement-breakpoint
ALTER TABLE `accruals` ADD `propertyName` varchar(255);--> statement-breakpoint
ALTER TABLE `accruals` ADD `unitName` varchar(120);--> statement-breakpoint
ALTER TABLE `accruals` ADD `tariffType` enum('monthly','daily');--> statement-breakpoint
ALTER TABLE `accruals` ADD `tariffAmount` decimal(12,2);--> statement-breakpoint
ALTER TABLE `accruals` ADD `notes` text;