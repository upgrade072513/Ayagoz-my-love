ALTER TABLE `invoices` ADD `emailStatus` enum('pending','sent','failed') DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD `emailSentAt` timestamp;--> statement-breakpoint
ALTER TABLE `invoices` ADD `emailError` varchar(500);