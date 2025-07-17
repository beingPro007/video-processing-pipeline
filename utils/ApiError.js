class ApiError extends Error {
    constructor(
        statusCode,
        message = "something Went Wrong",
        error = [],
        stack = ""
    ) {
        super(message)

        this.message = message
        this.statusCode = statusCode
        this.error = error

        if (stack) {
            this.stack = stack
        } else {
            Error.captureStackTrace(this, this.constructor)
        }
    }
}


export { ApiError }