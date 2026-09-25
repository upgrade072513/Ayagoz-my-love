CREATE TABLE `paymentAudit` (
	`id` int AUTO_INCREMENT NOT NULL,
	`paymentId` int NOT NULL,
	`invoiceId` int NOT NULL,
	`action` enum('recorded','reversed') NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`actorUserId` int,
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `paymentAudit_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`invoiceId` int NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`paidAt` date NOT NULL,
	`method` enum('bank','portal','card','cash','other') NOT NULL,
	`reference` varchar(255),
	`note` text,
	`proofFileKey` varchar(500),
	`proofFileUrl` varchar(700),
	`status` enum('posted','reversed') NOT NULL DEFAULT 'posted',
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `payments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `invoices` ADD `paymentStatus` enum('issued','partially_paid','paid','overdue','disputed','cancelled') DEFAULT 'issued' NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD `dueDate` date;