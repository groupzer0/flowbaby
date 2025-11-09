#!/usr/bin/env python3
"""Download sample data files for Cognee walkthrough."""

from utils.asset_helpers import download_remote_assets, preview_downloaded_assets

if __name__ == "__main__":
    print("Downloading sample data files...")
    asset_paths = download_remote_assets(force_download=True)
    print("\nDownload complete!")
    print("\nPreviewing downloaded assets:")
    preview_downloaded_assets(asset_paths)
