#!/usr/bin/env python3
"""Stream-parse a Roblox .rbxlx place file and emit the instance tree
(name + class only, no properties) for a set of top-level services."""
import json
import sys
import xml.sax

TARGETS = [
    "ServerScriptService",
    "StarterGui",
    "ReplicatedStorage",
    "StarterPlayer",
    "ServerStorage",
]


class TreeHandler(xml.sax.ContentHandler):
    def __init__(self):
        self.raw_item_depth = 0        # open <Item> elements, all of them
        self.building = False          # currently inside a target service subtree
        self.build_stack = []          # node stack while building
        self.results = {}              # service class -> root node
        self.capture_name = False      # capturing a <string name="Name"> value
        self.buf = []

    def startElement(self, tag, attrs):
        if tag == "Item":
            klass = attrs.get("class")
            is_service_level = self.raw_item_depth == 0
            self.raw_item_depth += 1
            if self.building:
                node = {"className": klass, "name": None, "children": []}
                self.build_stack[-1]["children"].append(node)
                self.build_stack.append(node)
            elif is_service_level and klass in TARGETS and klass not in self.results:
                node = {"className": klass, "name": None, "children": []}
                self.building = True
                self.build_stack = [node]
                self.results[klass] = node
        elif tag == "string" and self.building and attrs.get("name") == "Name":
            if self.build_stack and self.build_stack[-1]["name"] is None:
                self.capture_name = True
                self.buf = []

    def characters(self, content):
        if self.capture_name:
            self.buf.append(content)

    def endElement(self, tag):
        if tag == "string" and self.capture_name:
            self.build_stack[-1]["name"] = "".join(self.buf)
            self.capture_name = False
            self.buf = []
        elif tag == "Item":
            self.raw_item_depth -= 1
            if self.building:
                self.build_stack.pop()
                if not self.build_stack:
                    self.building = False


def main(path):
    handler = TreeHandler()
    parser = xml.sax.make_parser()
    parser.setContentHandler(handler)
    parser.parse(path)

    ordered = {svc: handler.results.get(svc) for svc in TARGETS}
    return ordered


if __name__ == "__main__":
    tree = main(sys.argv[1])
    out = sys.argv[2] if len(sys.argv) > 2 else None
    text = json.dumps(tree, indent=2)
    if out:
        with open(out, "w") as f:
            f.write(text)
    # summary counts to stderr
    def count(n):
        return 0 if n is None else 1 + sum(count(c) for c in n["children"])
    for svc in TARGETS:
        n = tree[svc]
        print(f"{svc}: {'ABSENT' if n is None else str(count(n)) + ' instances'}",
              file=sys.stderr)
