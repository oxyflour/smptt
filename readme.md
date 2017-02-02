# smptt
simple multi-path TCP tunnel

```
  Usage: smptt [options]

  Options:

    -h, --help                                         output usage information
    -V, --version                                      output the version number
    -F, --forward <[host:]port:remoteHost:remotePort>  forward host:port to remoteHost:remotePort, required as client
    -P, --peer <[host:]port>                           server address, required as client
    -l, --listen <[host:]port>                         listen address, required as server
    --pfx <string>                                     pfx file path, required
    --idle-timeout <integer>                           seconds to wait before closing idle connections. default 30s
    --ping-interval <integer>                          seconds to periodically update peer ping. default 5s
    --io-flush-interval <integer>                      milliseconds to flush data, default 5ms
    --io-max-buffer-size <integer>                     default 40
    --io-min-buffer-size <integer>                     default 30
    --sock-acknowledge-interval <integer>              send acknowledge message to another side every * packages. default 4
    --sock-max-acknowledge-offset <integer>            pause socket until last message received. default 64

```

## Examples

To listen as peer at both port 8124 and 8125
```
smptt -l 8124 -l 8125 --pfx $PFX_FILE
```

To listen at port 10022, and foward traffic to 127.0.0.122 at remote server via the two peers at example.com port 8124 and 8125
```
smptt -F 10022:127.0.0.1:22 -P example.com:8124 -P example.com:8125 --pfx $FPX_FILE
```
