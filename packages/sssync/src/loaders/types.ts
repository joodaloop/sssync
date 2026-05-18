export type LoaderConfig<Result = unknown> = {
  fetcher: () => Result | Promise<Result>
  once?: boolean
}

export type Loader<Args = unknown, Result = unknown> = (
  args: Args,
) => LoaderConfig<Result>

export type LoaderMap = Record<string, Loader<any, any>>
