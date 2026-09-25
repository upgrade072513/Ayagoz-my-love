CREATE TABLE `contractFolders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(120) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `contractFolders_id` PRIMARY KEY(`id`),
	CONSTRAINT `contractFolders_name_unique` UNIQUE(`name`)
);
