#!/usr/bin/env python3
import argparse
import json
import os
import re
import sys

# Configuration
SONGS_DIR = "Songs"
SCRIPTS_JS = "scripts.js"
BACKUP_HTML = "backup.html"
TITLES_JSON = "song_titles.json"

def update_file_text_refs(filepath, start_index):
    """
    Updates occurrences of songN.mp3 to song(N+1).mp3 in the given text file.
    """
    if not os.path.exists(filepath):
        print(f"Warning: {filepath} not found. Skipping.")
        return

    with open(filepath, 'r') as f:
        content = f.read()

    # 1. Update references like 'song149.mp3' -> 'song150.mp3'
    def ref_replacer(match):
        prefix = match.group(1) # 'song'
        num = int(match.group(2))
        suffix = match.group(3) # '.mp3'
        
        if num >= start_index:
            return f"{prefix}{num + 1}{suffix}"
        return match.group(0) # No change

    new_content = re.sub(r'(song)(\d+)(\.mp3)', ref_replacer, content)

    if content != new_content:
        with open(filepath, 'w') as f:
            f.write(new_content)
        print(f"Updated references in {filepath}")
    else:
        print(f"No changes needed in {filepath}")

def update_json_keys(filepath, start_index):
    """
    Updates keys in song_titles.json, shifting everything >= start_index up by 1.
    """
    if not os.path.exists(filepath):
        print(f"Warning: {filepath} not found. Skipping.")
        return

    print(f"Updating keys in {filepath}...")
    with open(filepath, 'r') as f:
        data = json.load(f)

    # Convert to list of (song_num, key, value, is_song_key)
    # We treat map as list of items to sort and re-key.
    items = []
    
    for key, value in data.items():
        m = re.match(r'song(\d+)\.mp3', key)
        if m:
            num = int(m.group(1))
            items.append({'num': num, 'key': key, 'value': value, 'is_song': True})
        else:
            items.append({'num': -1, 'key': key, 'value': value, 'is_song': False})

    # Prepare new data
    new_data_map = {}
    
    # Sort by number for clean output
    items.sort(key=lambda x: x['num'])

    # Build new dict
    for item in items:
        if item['is_song']:
            num = item['num']
            val = item['value']
            if num >= start_index:
                new_key = f"song{num + 1}.mp3"
                new_data_map[new_key] = val
            else:
                new_data_map[item['key']] = val
        else:
            new_data_map[item['key']] = item['value']

    with open(filepath, 'w') as f:
        json.dump(new_data_map, f, indent=4)
    print(f"Saved updated JSON to {filepath}")

def shift_files(songs_dir, start_index):
    """
    Renames files in the directory starting from start_index, moving upwards.
    Processed in reverse order to prevent overwrites.
    """
    if not os.path.exists(songs_dir):
        print(f"Error: Directory {songs_dir} not found.")
        return

    files = [f for f in os.listdir(songs_dir) if f.startswith('song') and f.endswith('.mp3')]
    
    # Parse numbers
    song_list = []
    for f in files:
        m = re.match(r'song(\d+)\.mp3', f)
        if m:
            song_list.append((int(m.group(1)), f))
    
    # Sort descending!
    song_list.sort(key=lambda x: x[0], reverse=True)
    
    count = 0
    for num, filename in song_list:
        if num >= start_index:
            new_name = f"song{num + 1}.mp3"
            src = os.path.join(songs_dir, filename)
            dst = os.path.join(songs_dir, new_name)
            os.rename(src, dst)
            print(f"Renamed: {filename} -> {new_name}")
            count += 1
            
    print(f"Moved {count} files.")

def main():
    parser = argparse.ArgumentParser(description="Shift song files to make space for a new track.")
    parser.add_argument("start_index", type=int, help="The song number you want to free up (e.g. 40). All songs from this number upwards will be shifted +1.")
    parser.add_argument("--skip-json", action="store_true", help="Skip updating keys in song_titles.json (Use this if you manually updated the JSON).")
    
    args = parser.parse_args()
    
    print(f"--- Shift Songs Tool ---")
    print(f"Target: Free up 'song{args.start_index}.mp3'")
    print(f"Directory: {os.getcwd()}")
    
    # Confirm
    confirm = input("Are you sure you want to proceed? [y/N]: ")
    if confirm.lower() != 'y':
        print("Aborted.")
        sys.exit(0)

    # 1. Update Code References
    update_file_text_refs(SCRIPTS_JS, args.start_index)
    update_file_text_refs(BACKUP_HTML, args.start_index)

    # 2. Update JSON
    if not args.skip_json:
        update_json_keys(TITLES_JSON, args.start_index)
    else:
        print("Skipping JSON update (--skip-json used).")

    # 3. Rename Files
    shift_files(SONGS_DIR, args.start_index)
    
    print("--- Done ---")
    print(f"Space created at song{args.start_index}.mp3")

if __name__ == "__main__":
    main()
