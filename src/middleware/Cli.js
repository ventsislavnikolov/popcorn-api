// Import the necessary modules.
// @flow
/* eslint-disable no-console */
import bytes from 'bytes'
import fs from 'fs'
import inquirer from 'inquirer'
import parseTorrent from 'parse-torrent'
import path from 'path'
// import pMap from 'p-map'
import webtorrentHealth from 'webtorrent-health'
import {
  Cli as BaseCli,
  Database
} from 'pop-api'

import MovieProvider from '../scraper/providers/MovieProvider'
import promptSchemas from './promptschemas.js'
import ShowProvider from '../scraper/providers/ShowProvider'
import {
  Movie,
  Show
} from '../models'
import { name } from '../../package'

/**
 * Class The class for the command line interface.
 * @type {Cli}
 */
export default class Cli extends BaseCli {

  /**
   * The name of the CLI provider. Default is `CLI`.
   * @type {string}
   */
  static _Name: string = 'CLI'

  /**
   * The database middleware from `pop-api`.
   * @type {Database}
   */
  _database: Database

  /**
   * Create a CLI object.
   * @param {!PopApi} PopApi - The PopApi instance to bind the cli to.
   * @param {!Ojbect} options - The options for the cli.
   * @param {?Array<string>} options.argv - The arguments to be parsed by
   * commander.
   * @param {!string} options.name - The name of the Cli program.
   * @param {!string} [options.version] - The version of the Cli program.
   */
  constructor(PopApi: any, {argv, name, version}: Object): void {
    super(PopApi, {name, version})

    /**
    * The database middleware from `pop-api`.
    * @type {Database}
    */
    this._database = new Database({}, {
      database: name
    })

    if (argv) {
      this._run(PopApi, argv)
    }
  }

  /**
   * Initiate the options for the Cli.
   * @param {!string} version - The version of the Cli program.
   * @returns {undefined}
   */
  initOptions(version: string): void {
    super.initOptions(version)

    return this.program
      .option('-s, --start', 'Start the scraping process')
      .option('--content <type>',
        'Add content to the MongoDB database (animemovie|animeshow|movie|show).',
        /^(animemovie|animeshow|movie|show)$/i, false)
      .option(
        '--providers <env>',
        'Add provider configurations',
        /^(development|production|test)$/i
      )
      .option('--export <collection>',
        'Export a collection to a JSON file.',
        /^(anime|movie|show)$/i, false)
      .option('--import <collection>', 'Import a JSON file to the database.')
  }

  /**
   * Method for displaying the --help option
   * @returns {undefined}
   */
  help(): void {
    super.help()
    console.info(`    $ ${name} --content <animemovie|animeshow|movie|show>\n`)
    console.info(`    $ ${name} --provider\n`)
    console.info(`    $ ${name} --export <anime|movie|show>\n`)
    console.info(`    $ ${name} --import <path-to-json>\n`)
  }

  /**
   * Return a torrent object for a movie.
   * @param {!string} magnet - The magnet url to bind.
   * @param {!Object} health - The health object for seeders and peers.
   * @param {!Object} remote - The remote data object from 'parseTorrent'.
   * @returns {Object} - A torrent object for a movie.
   */
  _movieTorrent(magnet: string, health: Object, remote: Object): Object {
    return {
      url: magnet,
      seeds: health.seeds,
      peers: health.peers,
      size: remote.length,
      filesize: bytes(remote.length),
      provider: Cli._Name
    }
  }

  /**
   * Return a torrent object for a show.
   * @param {!string} magnet - The magnet url to bind.
   * @param {!Object} health - The health object for seeders and peers.
   * @returns {Object} - A torrent object for a show.
   */
  _tvshowTorrent(magnet: string, health: Object): Object {
    return {
      url: magnet,
      seeds: health.seeds,
      peers: health.peers,
      provider: Cli._Name
    }
  }

  /**
   * Get a torrent object based on the type.
   * @param {!string} link - The link to bind to the torrent object.
   * @param {!string} type - The type of torrent object (movie|show).
   * @returns {Promise<Object, undefined>} - A torrent object for a movie or
   * show.
   */
  _getTorrent(link: string, type: string): Promise<Object | void> {
    return new Promise((resolve, reject) => {
      return parseTorrent.remote(link, (err, remote) => {
        if (err) {
          return reject(err)
        }

        const magnet = parseTorrent.toMagnetURI(remote)
        return webtorrentHealth(magnet).then(health => {
          const torrent = type === 'movie'
            ? this._movieTorrent(magnet, health, remote)
            : this._tvshowTorrent(magnet, health)
          return resolve(torrent)
        })
      })
    })
  }

  /**
   * Handle the --content CLI option to insert a movie torrent.
   * @param {!string} t - The content type to add to the database.
   * @returns {Promise<Movie, Error>} - The inserted movie.
   */
  _moviePrompt(t: string): Promise<Movie | Error> {
    const { imdb, torrent, movieQuality, language } = promptSchemas
    const movieSchema: Array<Object> = [
      imdb,
      torrent,
      movieQuality,
      language
    ]

    return inquirer.prompt(movieSchema).then(res => {
      const { imdb, quality, language, torrent } = res
      const movie = {
        slugYear: imdb,
        torrents: {}
      }
      const type = MovieProvider.Types.Movie
      const movieProvider = new MovieProvider({
        name: Cli._Name,
        modelType: t,
        type
      })

      return this._getTorrent(torrent, type).then(res => {
        const args = [movie, res, quality, language]
        movieProvider.attachTorrent(...args)

        return movieProvider.getContent(movie)
      })
    }).then(() => process.exit(0))
      .catch(err => {
        logger.error(`An error occurred: '${err}'`)
        return process.exit(1)
      })
  }

  /**
   * Handle the --content CLI option to insert a movie torrent.
   * @param {!string} t - The content type to add to the database.
   * @returns {Promise<Show, Error>} - The inserted show.
   */
  _showPrompt(t: string): Promise<Show | Error> {
    const {
      imdb,
      torrent,
      showQuality,
      season,
      episode,
      dateBased
    } = promptSchemas
    const showSchema: Array<Object> = [
      imdb,
      torrent,
      showQuality,
      season,
      episode,
      dateBased
    ]

    return inquirer.prompt(showSchema).then(res => {
      const { imdb, season, episode, quality, dateBased, torrent } = res
      const show = {
        slug: imdb,
        dateBased,
        episodes: {}
      }
      const type = MovieProvider.Types.Show
      const showProvider = new ShowProvider({
        name: Cli._Name,
        modelType: t,
        type
      })

      return this._getTorrent(torrent, type).then(res => {
        const args = [show, res, season, episode, quality]
        showProvider.attachTorrent(...args)

        return showProvider.getContent(show)
      })
    }).then(() => process.exit(0))
      .catch(err => {
        logger.error(`An error occurred: '${err}'`)
        return process.exit(1)
      })
  }

  /**
   * Handle the --content CLI option.
   * @param {!string} t - The content type to add to the database.
   * @returns {Promise<Movie|Show, Error>|undefined} - The inserted movie or
   * show.
   */
  _content(t: string): Promise<Movie | Show | Error> | void {
    switch (t) {
      case 'animemovie':
        return this._moviePrompt(t)
      case 'animeshow':
        return this._showPrompt(t)
      case 'movie':
        return this._moviePrompt(t)
      case 'show':
        return this._showPrompt(t)
      default:
        logger.error(`'${t}' is not a valid option for content!`)
        return process.exit(1)
    }
  }

  /**
   * Handle the --export CLI option.
   * @param {!string} e - The collection to export.
   * @returns {Promise<string, undefined>} - The promise to export a collection.
   */
  _export(e: string): Promise<string | void> {
    return this._database.exportCollection(e)
      .then(() => process.exit(0))
      .catch(err => {
        logger.error(`An error occurred: ${err}`)
        return process.exit(1)
      })
  }

  /**
   * Handle the --import CLI option.
   * @param {!string} i - The collection to import.
   * @throws {Error} - Error: no such file found for 'JSON_FILE'
   * @returns {Promise<string, undefined>|undefined} - The promise to import a
   * collection.
   */
  _import(i: string): Promise<string | void> | void {
    if (!fs.existsSync(i)) {
      logger.error(`File '${i}' does not exists!`)
      return process.exit(1)
    }

    const { confirm } = promptSchemas
    return inquirer.prompt([confirm]).then(({ confirm }) => {
      if (confirm) {
        return this._database.importCollection(path.basename(i, '.json'), i)
      }

      return process.exit(0)
    }).catch(err => {
      logger.error(`An error occurred: ${err}`)
      return process.exit(1)
    })
  }

  /**
   * Run the Cli program.
   * @param {!PopApi} PopApi - The PopApi instance to bind the logger to.
   * @param {?Array<string>} argv - The arguments to be parsed by commander.
   * @returns {undefined}
   */
  _run(PopApi: any, argv?: Array<string>): any {
    if (argv) {
      this.program.parse(argv)
    }

    if (this.program.content) {
      return this._content(this.program.content)
    } else if (this.program.export) {
      return this._export(this.program.export)
    } else if (this.program.import) {
      return this._import(this.program.import)
    }

    if (this.program.start) {
      PopApi.startScraper = true
    }

    return super._run(PopApi)
  }

}
