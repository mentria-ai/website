def num: (capture("/pull/(?<n>[0-9]+)$").n) // "";
def title: sub(" by @[^ ]+ in .*$"; "");
def reverts($c): .n != $c.n and ((.t | contains("(#" + $c.n + ")")) or .t == "Revert \"" + $c.t + "\"");
def items: (split("\n") | map(select(startswith("* ")) | ltrimstr("* ") | {n: num, t: title})) as $all
  | [$all[] | select(.t | startswith("Revert ")) as $r | [$all[] | . as $c | select($r | reverts($c)) | .n] | select(length > 0) | $r.n, .[]] as $drop
  | [$all[] | select(.t | (startswith("Release:") or startswith("Beta:")) | not) | select(.n as $n | $drop | any(.[]; . == $n) | not) | .t];
(.body | items) as $items
| {tag: $tag, url: $url, date: $date, items: $items,
   releases: ([{tag: $tag, url: $url, date: $date, items: $items}]
     + [(($past // [])[0] // [])[] | select((.draft or .prerelease) | not) | select(.tag_name != $tag) | {tag: .tag_name, url: .html_url, date: .published_at, items: ((.body // "") | items)}])[:10]}
