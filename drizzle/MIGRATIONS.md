# Database Migrations Guide

This document provides instructions for executing database migrations in this project.

## Migration Files

Migration files are located in the `drizzle/` directory and are numbered sequentially:

- `0000_initial_schema.sql` - Initial database schema
- `0001_add_summary_language.sql` - Add bilingual summary support

## How to Run Migrations

### Using Drizzle Kit

```bash
# Apply all pending migrations
npx drizzle-kit push

# Or use wrangler for D1 database
npx wrangler d1 migrations apply <DATABASE_NAME>
```

### Manual Execution

If you need to run migrations manually:

```bash
# For local D1 database
npx wrangler d1 execute <DATABASE_NAME> --local --file=./drizzle/0001_add_summary_language.sql

# For production D1 database
npx wrangler d1 execute <DATABASE_NAME> --file=./drizzle/0001_add_summary_language.sql
```

## Migration 0001: Add Summary Language Support

### Overview

This migration adds support for bilingual paper summaries (English and Simplified Chinese).

### ⚠️ CRITICAL WARNING

**This is a DESTRUCTIVE migration that CANNOT be rolled back.**

### Impact

1. **Data Loss**: All existing paper analysis results will be permanently deleted
2. **User Action Required**: Users must regenerate all paper analyses after migration
3. **Orphaned R2 Objects**: Mindmap images in R2 storage will become orphaned
   - These images will NOT be automatically deleted
   - Manual cleanup may be required to reclaim storage space
4. **Preserved Data**: Credit transactions and paper metadata remain intact

### Pre-Migration Checklist

Before running this migration, consider the following actions:

#### 1. Backup Paper Results (Optional)

```sql
-- Create a backup table
CREATE TABLE `paper_results_backup` AS SELECT * FROM `paper_results`;
```

#### 2. Export R2 Keys for Cleanup (Optional)

```sql
-- Export list of R2 keys that will become orphaned
SELECT mindmap_image_r2_key
FROM `paper_results`
WHERE mindmap_image_r2_key IS NOT NULL;
```

Save this list for later R2 cleanup if needed.

#### 3. User Communication

Notify users that:
- All existing paper analyses will be deleted
- They need to re-upload or regenerate their papers
- This is necessary to support the new bilingual feature

### Post-Migration Actions

After running the migration:

1. **Verify Schema**: Check that the `summary_language` column exists
   ```sql
   PRAGMA table_info(paper_results);
   ```

2. **Test New Feature**: Upload a test paper and verify bilingual summaries work

3. **R2 Cleanup** (Optional): If storage space is a concern, clean up orphaned images
   ```bash
   # Use the exported R2 keys list to delete orphaned objects
   wrangler r2 object delete <BUCKET_NAME> <KEY>
   ```

### Rollback Strategy

**There is NO automatic rollback for this migration.**

If you need to revert:

1. Drop the `summary_language` column:
   ```sql
   ALTER TABLE `paper_results` DROP COLUMN `summary_language`;
   ```

2. Restore from backup (if created):
   ```sql
   INSERT INTO `paper_results` SELECT * FROM `paper_results_backup`;
   DROP TABLE `paper_results_backup`;
   ```

**Note**: This only works if you created a backup before migration.

## Best Practices

1. **Always test migrations in a development environment first**
2. **Create backups before running destructive migrations**
3. **Communicate breaking changes to users in advance**
4. **Document all manual cleanup steps required**
5. **Keep migration files immutable** - never edit a migration that has been applied

## Troubleshooting

### Migration Fails

If a migration fails:

1. Check the error message carefully
2. Verify database connection and permissions
3. Ensure no other processes are accessing the database
4. Check D1 database limits and quotas

### Data Inconsistency

If you notice data inconsistencies after migration:

1. Check if the migration completed successfully
2. Verify the schema matches expectations
3. Review application logs for errors
4. Consider restoring from backup if available

## Support

For issues or questions about migrations:

1. Check the migration file comments for specific details
2. Review Cloudflare D1 documentation
3. Check Drizzle ORM documentation
4. Review project commit history for context
