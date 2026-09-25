CREATE TABLE `accruals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`contractId` int NOT NULL,
	`period` varchar(7) NOT NULL,
	`serviceFrom` date NOT NULL,
	`serviceTo` date NOT NULL,
	`quantity` decimal(12,2) NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`status` enum('draft','invoiced') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `accruals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `contracts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantName` varchar(255) NOT NULL,
	`tenantContact` varchar(255),
	`propertyName` varchar(255) NOT NULL,
	`unitName` varchar(120),
	`startDate` date NOT NULL,
	`endDate` date NOT NULL,
	`tariffType` enum('monthly','daily') NOT NULL,
	`tariffAmount` decimal(12,2) NOT NULL,
	`status` enum('active','paused','ended') NOT NULL DEFAULT 'active',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `contracts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`contractId` int NOT NULL,
	`fileName` varchar(255) NOT NULL,
	`mimeType` varchar(120) NOT NULL,
	`fileKey` varchar(500) NOT NULL,
	`fileUrl` varchar(700) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invoiceItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`invoiceId` int NOT NULL,
	`accrualId` int NOT NULL,
	`description` varchar(500) NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	CONSTRAINT `invoiceItems_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`invoiceNumber` varchar(40) NOT NULL,
	`issueDate` date NOT NULL,
	`period` varchar(7) NOT NULL,
	`tenantName` varchar(255) NOT NULL,
	`totalAmount` decimal(12,2) NOT NULL,
	`status` enum('issued','paid','cancelled') NOT NULL DEFAULT 'issued',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `invoices_id` PRIMARY KEY(`id`),
	CONSTRAINT `invoices_invoiceNumber_unique` UNIQUE(`invoiceNumber`)
);
