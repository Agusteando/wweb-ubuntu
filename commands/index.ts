import { listDirectoryFiles } from '@adonisjs/core/build/standalone'
import Application from '@ioc:Adonis/Core/Application'

/*
|--------------------------------------------------------------------------
| Exporting an array of commands
|--------------------------------------------------------------------------
|
| Instead of manually exporting each file from this directory, we use the
| helper `listDirectoryFiles` to recursively collect and export an array
| of filenames.
|
*/
export default listDirectoryFiles(__dirname, Application.appRoot, ['./commands/index'])