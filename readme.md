# smptt
simple multi-path TCP tunnel

```
  Usage: smptt [options]

  Options:

    -h, --help           output usage information
    -V, --version        output the version number
    -p, --port <number>  port number, required
    -P, --peer <addr>    peer address like localhost:8081, required as sender
    -t, --target <addr>  target address like localhost:8082, required as receiver
    --pfx <file>         pfx file containning ca/crt/key, required to use tls
```

## Examples

To listen as peer at both port 8124 and 8125, and forward received traffic to port 8123
```
smptt -p 8124 -p 8125 -t 8123
```

To listen at port 8123, and foward traffic via the two peers at example.com port 8124 and 8125
```
smptt -p 8123 -P example.com:8124 -P example.com:8125
```
