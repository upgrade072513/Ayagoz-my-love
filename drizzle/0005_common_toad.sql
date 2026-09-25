CREATE TABLE `contractAuditLog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`contractId` int NOT NULL,
	`actorUserId` int,
	`action` enum('viewed','created','updated') NOT NULL,
	`details` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `contractAuditLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `departments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `departments_id` PRIMARY KEY(`id`),
	CONSTRAINT `departments_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `documentPermissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`documentId` int NOT NULL,
	`userId` int,
	`departmentId` int,
	`canView` enum('yes','no') NOT NULL DEFAULT 'yes',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `documentPermissions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('user','admin','manager','viewer','auditor') NOT NULL DEFAULT 'user';--> statement-breakpoint
ALTER TABLE `contracts` ADD `departmentId` int;--> statement-breakpoint
ALTER TABLE `users` ADD `departmentId` int;