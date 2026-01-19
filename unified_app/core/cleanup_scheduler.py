"""
Cleanup Scheduler - Auto-delete old recordings and timelapse files
"""
import os
import time
import logging
from datetime import datetime, timedelta
from pathlib import Path
from threading import Thread
import yaml

logger = logging.getLogger(__name__)


class CleanupScheduler:
    """Scheduler that runs cleanup tasks based on config"""

    def __init__(self, config_path="config.yaml"):
        self.config_path = config_path
        self.running = False
        self.thread = None
        logger.info("CleanupScheduler initialized")

    def start(self):
        """Start the cleanup scheduler thread"""
        if self.running:
            logger.warning("CleanupScheduler already running")
            return

        self.running = True
        self.thread = Thread(target=self._loop, daemon=True)
        self.thread.start()
        logger.info("CleanupScheduler started")

    def stop(self):
        """Stop the cleanup scheduler thread"""
        self.running = False
        if self.thread:
            self.thread.join(timeout=5)
        logger.info("CleanupScheduler stopped")

    def _load_config(self):
        """Load cleanup config from yaml file"""
        try:
            with open(self.config_path, 'r', encoding='utf-8') as f:
                cfg = yaml.safe_load(f)
            return cfg.get('cleanup', {})
        except Exception as e:
            logger.error(f"Failed to load cleanup config: {e}")
            return {}

    def _loop(self):
        """Main scheduler loop - checks every 30 seconds"""
        last_cleanup_date = None

        while self.running:
            try:
                cleanup_cfg = self._load_config()

                # Check if cleanup is enabled
                if not cleanup_cfg.get('enabled', False):
                    time.sleep(30)
                    continue

                # Get schedule time (default 03:00)
                schedule_time = cleanup_cfg.get('schedule', '03:00')
                now = datetime.now()
                current_time = now.strftime("%H:%M")
                current_date = now.date()

                # Run cleanup if:
                # 1. Current time matches schedule time
                # 2. Haven't run cleanup today yet
                if current_time == schedule_time and last_cleanup_date != current_date:
                    logger.info(f"Starting scheduled cleanup at {current_time}")
                    self._execute_cleanup(cleanup_cfg)
                    last_cleanup_date = current_date

                time.sleep(30)  # Check every 30 seconds

            except Exception as e:
                logger.error(f"Error in cleanup scheduler loop: {e}", exc_info=True)
                time.sleep(30)

    def _execute_cleanup(self, cleanup_cfg):
        """Execute cleanup based on retention settings"""
        try:
            recordings_retention = cleanup_cfg.get('recordings_retention_days', 30)
            timelapse_retention = cleanup_cfg.get('timelapse_retention_days', 90)

            logger.info(f"Cleanup config: recordings={recordings_retention}d, timelapse={timelapse_retention}d")

            # Calculate cutoff dates
            now = datetime.now()
            recordings_cutoff = now - timedelta(days=recordings_retention)
            timelapse_cutoff = now - timedelta(days=timelapse_retention)

            # Clean recordings
            recordings_deleted = self._cleanup_directory(
                'recordings',
                recordings_cutoff,
                ['.mp4', '.mkv', '.avi']
            )

            # Clean timelapse
            timelapse_deleted = self._cleanup_directory(
                'timelapse',
                timelapse_cutoff,
                ['.mp4', '.mkv', '.avi']
            )

            logger.info(f"Cleanup completed: {recordings_deleted} recordings, {timelapse_deleted} timelapse files deleted")

        except Exception as e:
            logger.error(f"Error executing cleanup: {e}", exc_info=True)

    def _cleanup_directory(self, dir_name, cutoff_date, extensions):
        """Clean files in directory older than cutoff date"""
        deleted_count = 0
        deleted_size = 0

        try:
            dir_path = Path(dir_name)
            if not dir_path.exists():
                logger.warning(f"Directory {dir_name} does not exist")
                return deleted_count

            # Recursively find all video files
            for ext in extensions:
                for file_path in dir_path.rglob(f'*{ext}'):
                    try:
                        # Get file modification time
                        file_mtime = datetime.fromtimestamp(file_path.stat().st_mtime)

                        # Delete if older than cutoff
                        if file_mtime < cutoff_date:
                            file_size = file_path.stat().st_size
                            file_path.unlink()
                            deleted_count += 1
                            deleted_size += file_size
                            logger.debug(f"Deleted: {file_path} (modified: {file_mtime})")

                            # Also delete associated thumbnail if exists
                            thumbnail_path = file_path.with_suffix('.jpg')
                            if thumbnail_path.exists():
                                thumbnail_path.unlink()
                                logger.debug(f"Deleted thumbnail: {thumbnail_path}")

                    except Exception as e:
                        logger.error(f"Error deleting file {file_path}: {e}")

            if deleted_count > 0:
                logger.info(f"Deleted {deleted_count} files from {dir_name} ({deleted_size / (1024*1024):.2f} MB)")

        except Exception as e:
            logger.error(f"Error cleaning directory {dir_name}: {e}", exc_info=True)

        return deleted_count

    def execute_now(self):
        """Execute cleanup immediately (for manual trigger)"""
        logger.info("Manual cleanup triggered")
        cleanup_cfg = self._load_config()
        if cleanup_cfg.get('enabled', False):
            self._execute_cleanup(cleanup_cfg)
        else:
            logger.warning("Cleanup is disabled in config")
