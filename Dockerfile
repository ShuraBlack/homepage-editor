# The Go build runs on the build machine's platform and cross-compiles for the target
# (multi-arch images in the release workflow without emulation; plain `docker compose build` works as before).
FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS build
ARG TARGETOS TARGETARCH
WORKDIR /src
COPY go.mod VERSION ./
COPY *.go ./
COPY web ./web
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /homepage-editor .

FROM gcr.io/distroless/static-debian12
COPY --from=build /homepage-editor /homepage-editor
EXPOSE 3001
ENTRYPOINT ["/homepage-editor"]
