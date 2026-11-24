-- Match the default operation limits at the storage boundary as well.
update storage.buckets set file_size_limit = 10485760 where id in ('source-files','restored-files');
update storage.buckets set file_size_limit = 31457280 where id = 'backup-archives';
