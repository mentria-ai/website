def num: (capture("/pull/(?<n>[0-9]+)$").n) // "";
def title: sub(" by @[^ ]+ in .*$"; "");
def reverts($c): .n != $c.n and ((.t | contains("(#" + $c.n + ")")) or .t == "Revert \"" + $c.t + "\"");
(.body | split("\n") | map(select(startswith("* ")) | ltrimstr("* ") | {n: num, t: title})) as $all
| [$all[] | select(.t | startswith("Revert ")) as $r | [$all[] | . as $c | select($r | reverts($c)) | .n] | select(length > 0) | $r.n, .[]] as $drop
| {tag: $tag, url: $url, date: $date, items: [$all[] | select(.t | startswith("Release:") | not) | select(.n as $n | $drop | any(.[]; . == $n) | not) | .t]}
