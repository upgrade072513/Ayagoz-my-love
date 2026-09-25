ALTER TABLE `documents` ADD `encryptionVersion` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `encryptionIv` varchar(64);--> statement-breakpoint
ALTER TABLE `documents` ADD `encryptionAuthTag` varchar(64);