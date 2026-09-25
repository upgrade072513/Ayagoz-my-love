CREATE TABLE `securityAuditLog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventType` varchar(64) NOT NULL,
	`actorUserId` int,
	`targetUserId` int,
	`oldValue` text,
	`newValue` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `securityAuditLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `userInvitations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`invitedByUserId` int NOT NULL,
	`email` varchar(320) NOT NULL,
	`role` enum('admin','manager') NOT NULL,
	`departmentId` int,
	`managedBlocks` text,
	`tokenHash` varchar(128) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`acceptedAt` timestamp,
	`revokedAt` timestamp,
	CONSTRAINT `userInvitations_id` PRIMARY KEY(`id`),
	CONSTRAINT `userInvitations_tokenHash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('admin','manager') NOT NULL DEFAULT 'manager';--> statement-breakpoint
ALTER TABLE `securityAuditLog` ADD CONSTRAINT `securityAuditLog_actorUserId_users_id_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `securityAuditLog` ADD CONSTRAINT `securityAuditLog_targetUserId_users_id_fk` FOREIGN KEY (`targetUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `userInvitations` ADD CONSTRAINT `userInvitations_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `userInvitations` ADD CONSTRAINT `userInvitations_invitedByUserId_users_id_fk` FOREIGN KEY (`invitedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `securityAuditLog_actorUserId_idx` ON `securityAuditLog` (`actorUserId`);--> statement-breakpoint
CREATE INDEX `securityAuditLog_targetUserId_idx` ON `securityAuditLog` (`targetUserId`);--> statement-breakpoint
CREATE INDEX `securityAuditLog_createdAt_idx` ON `securityAuditLog` (`createdAt`);--> statement-breakpoint
CREATE INDEX `userInvitations_userId_idx` ON `userInvitations` (`userId`);--> statement-breakpoint
CREATE INDEX `userInvitations_expiresAt_idx` ON `userInvitations` (`expiresAt`);