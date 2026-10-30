"""Extracts A Township Tale's world map from your own game install, for the Canary viewer and Rover.

Writes two files: the map image (map.png, 2048x2048) and map.json, which says which world area the image
covers ({"bottomLeft": [x, z], "topRight": [x, z]}). Drop both into the viewer alongside a recording.

The game draws its map board from one texture (MapBoardDirectRenderer.map) stretched over the corners its
Map asset ("MainMap") stores; the pieces players uncover are only fog laid over it. This reads those two
objects straight from the game's data files: no running game needed. The image is the game's own artwork,
so it is extracted from each person's install rather than shipped with Canary.

Needs UnityPy (pip install UnityPy). Usage:
    python extract_map.py "C:/Program Files (x86)/Steam/steamapps/common/A Township Tale" [out_dir]
"""
import json
import os
import struct
import sys

import UnityPy
from UnityPy.enums import ClassIDType


class Reader:
    """Little-endian reads over a MonoBehaviour's raw bytes (these scripts ship without type trees)."""

    def __init__(self, data):
        self.data, self.pos = data, 0

    def int32(self):
        (v,) = struct.unpack_from("<i", self.data, self.pos)
        self.pos += 4
        return v

    def floats(self, n):
        v = struct.unpack_from(f"<{n}f", self.data, self.pos)
        self.pos += 4 * n
        return v

    def pptr(self):
        file_id, path_id = struct.unpack_from("<iq", self.data, self.pos)
        self.pos += 12
        return file_id, path_id

    def string(self):
        n = self.int32()
        s = self.data[self.pos:self.pos + n].decode("utf-8", "replace")
        self.pos += (n + 3) // 4 * 4
        return s

    def mono_header(self):
        """MonoBehaviour's own fields: m_GameObject, m_Enabled (padded), m_Script, m_Name."""
        self.pptr()
        self.pos += 4
        self.pptr()
        return self.string()


def script_of(obj):
    try:
        script = obj.read(check_read=False).m_Script.read()
        return script.m_Namespace, script.m_ClassName
    except Exception:
        return None, None


def find(data_dir):
    """The MainMap asset's corners and the map board renderer's texture, from the game's .assets files."""
    corners, texture = None, None
    for name in sorted(os.listdir(data_dir)):
        if not name.endswith(".assets"):
            continue
        env = UnityPy.load(os.path.join(data_dir, name))
        for obj in env.objects:
            if obj.type != ClassIDType.MonoBehaviour:
                continue
            ns, cls = script_of(obj)
            if ns != "Alta.Map" or cls not in ("Map", "MapBoardDirectRenderer"):
                continue
            r = Reader(obj.get_raw_data())
            name_field = r.mono_header()
            if cls == "Map" and corners is None:
                # HashedGeneralValue: description, hash; then Map: pieces[], globalMapPieces[], the two corners.
                r.string()
                r.int32()
                for _ in range(2):
                    count = r.int32()
                    r.pos += 12 * count
                bl, tr = r.floats(2), r.floats(2)
                if bl[0] < tr[0] and bl[1] < tr[1]:
                    corners = {"name": name_field, "bottomLeft": list(bl), "topRight": list(tr)}
            elif cls == "MapBoardDirectRenderer" and texture is None:
                r.pptr()  # mapBoard
                r.pptr()  # landmarkDisplay
                file_id, path_id = r.pptr()  # map
                assets = obj.assets_file
                if file_id != 0:
                    ext = assets.externals[file_id - 1].name
                    assets = UnityPy.load(os.path.join(data_dir, os.path.basename(ext))).file
                    assets = next(iter(assets.files.values())) if hasattr(assets, "files") else assets
                texture = assets.objects[path_id].read()
        if corners and texture:
            break
    return corners, texture


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    game = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else "."
    data_dir = os.path.join(game, "A Township Tale_Data")
    if not os.path.isdir(data_dir):
        sys.exit(f"No 'A Township Tale_Data' folder in {game}")
    corners, texture = find(data_dir)
    if not corners or not texture:
        sys.exit("Couldn't find the map in this install (the game's data layout may have changed).")
    os.makedirs(out, exist_ok=True)
    texture.image.save(os.path.join(out, "map.png"))
    info = dict(corners, image="map.png", width=texture.m_Width, height=texture.m_Height, texture=texture.m_Name)
    with open(os.path.join(out, "map.json"), "w", encoding="utf-8") as f:
        json.dump(info, f, indent=2)
    size = corners["topRight"][0] - corners["bottomLeft"][0]
    print(f"{texture.m_Name} {texture.m_Width}x{texture.m_Height}: world x {corners['bottomLeft'][0]:g}..{corners['topRight'][0]:g}, "
          f"z {corners['bottomLeft'][1]:g}..{corners['topRight'][1]:g} ({size:g} m across). Wrote map.png and map.json to {out}")


if __name__ == "__main__":
    main()
